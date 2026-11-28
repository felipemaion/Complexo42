#!/usr/bin/env bash
# Varredura de dado pessoal em claro (#155, ADR 0003, R13), no banco do "staging de mentira", DEPOIS do E2E.
#
# O E2E digitou nome, WhatsApp e e-mail de pessoas fictícias e grava os trechos num arquivo (uma linha por trecho):
#   claro:<texto>   não pode aparecer em NENHUMA coluna de NENHUMA tabela do banco, nem em `auth.*` (o GoTrue não recebe nome
#                   nem WhatsApp neste cadastro; com o Google ele guarda o perfil, o que o staging de mentira não tem);
#   email:<texto>   não pode aparecer em lugar nenhum fora de `auth.*` (o e-mail de login é do GoTrue).
# Mais: todo valor de coluna `*_enc` de `public` e `app` tem a forma cifrada (`app.is_encrypted_value`).
#
# Só SQL dentro do container do banco, sem `pg_dump`: não nasce arquivo com dados, e a saída traz SÓ `esquema.tabela.coluna`,
# nunca o valor. Falha (exit 1) se achar qualquer coisa.
#
# Uso: DB=<container do banco> scripts/staging-ci/varredura.sh <arquivo de trechos>
set -euo pipefail

ARQUIVO=${1:?uso: DB=<container> varredura.sh <arquivo de trechos>}
DB=${DB:?falta DB (o container do banco)}
[ -s "$ARQUIVO" ] || { echo "arquivo de trechos vazio ou ausente" >&2; exit 2; }

CLARO=; EMAIL=
while IFS= read -r linha || [ -n "$linha" ]; do
  case "$linha" in
    claro:*) CLARO+="${linha#claro:}"$'\n' ;;
    email:*) EMAIL+="${linha#email:}"$'\n' ;;
    '') ;;
    *) echo "linha de trecho desconhecida" >&2; exit 2 ;;
  esac
done < "$ARQUIVO"
CLARO=${CLARO%$'\n'}; EMAIL=${EMAIL%$'\n'}
[ -n "$CLARO$EMAIL" ] || { echo "nenhum trecho para varrer" >&2; exit 2; }

SAIDA=$(docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -At \
  -v claro="$CLARO" -v email="$EMAIL" <<'SQL'
-- Trechos de texto em claro: por coluna, sem devolver o valor.
create function pg_temp.varre_trechos(p_claro text[], p_email text[]) returns table (onde text) language plpgsql as $f$
declare
  r record;
  trecho text;
  achou boolean;
begin
  for r in
    select c.table_schema as s, c.table_name as t, c.column_name as col
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema not in ('pg_catalog', 'information_schema') and c.table_schema not like 'pg\_%'
  loop
    foreach trecho in array p_claro || case when r.s = 'auth' then '{}'::text[] else p_email end loop
      continue when trecho = '';
      execute format('select exists (select 1 from %I.%I where position(lower(%L) in lower(%I::text)) > 0)', r.s, r.t, trecho, r.col) into achou;
      if achou then
        onde := 'texto em claro em ' || r.s || '.' || r.t || '.' || r.col;
        return next;
        exit;
      end if;
    end loop;
  end loop;
end
$f$;

-- Forma cifrada em toda coluna `*_enc`.
create function pg_temp.varre_forma() returns table (onde text) language plpgsql as $f$
declare
  r record;
  ruim boolean;
begin
  for r in
    select c.table_schema as s, c.table_name as t, c.column_name as col
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema in ('public', 'app') and c.column_name like E'%\\_enc'
  loop
    execute format('select exists (select 1 from %I.%I where %I is not null and not app.is_encrypted_value(%I, 1048576))', r.s, r.t, r.col, r.col) into ruim;
    if ruim then
      onde := 'valor sem a forma cifrada em ' || r.s || '.' || r.t || '.' || r.col;
      return next;
    end if;
  end loop;
end
$f$;

select * from pg_temp.varre_trechos(string_to_array(:'claro', E'\n'), string_to_array(:'email', E'\n'));
select * from pg_temp.varre_forma();
SQL
)

if [ -n "$SAIDA" ]; then
  printf '%s\n' "$SAIDA"
  echo "ERRO: dado pessoal em claro no banco (acima: esquema.tabela.coluna, sem o valor)." >&2
  exit 1
fi
echo "ok: nenhum trecho em claro e toda coluna *_enc com a forma cifrada"
