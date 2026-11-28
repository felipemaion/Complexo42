#!/usr/bin/env bash
# Aplica as migrations pendentes antes de trocar o app (issue #81, ADR 0009 §3).
# Chamado pelo deploy.sh como $MIGRA com APP_IMAGEM no ambiente. Sai != 0 em
# qualquer falha, e é isso que faz o deploy abortar com o app intacto.
#
# As migrations vêm DA IMAGEM que o deploy vai subir -- a MESMA referência,
# tag ou digest --, não de um checkout no servidor. O schema tem de ser o que
# veio com aquela imagem, e com digest isso deixa de depender de um ponteiro.
#
# O psql roda DENTRO do container do banco (`docker exec`), sem `-h` e sem
# senha. Isso NÃO é suposição: foi conferido no container do staging em
# 2026-11-19 -- conexão pelo socket local entra por `trust`/`peer`. Assim a
# senha do Postgres não atravessa lugar nenhum.
#
# Uso: migra.sh [--adotar]
set -euo pipefail
umask 077

DB_CONTAINER=${DB_CONTAINER:-}
DB_USER=${DB_USER:-supabase_admin}
DB_NOME=${DB_NOME:-postgres}
ADOTAR=
DE=

while [ $# -gt 0 ]; do
  case "$1" in
    --adotar) ADOTAR=1; shift ;;
    # Só para teste, e só fora do root: com privilégio, um diretório vindo de
    # fora seria SQL arbitrário executado como superusuário do banco.
    --de) [ "$(id -u)" -eq 0 ] && { echo "--de nao e permitido como root" >&2; exit 2; }
          DE=${2:?falta o diretorio}; shift 2 ;;
    *) echo "uso: migra.sh [--adotar]" >&2; exit 2 ;;
  esac
done

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# Checagem explícita, e NÃO `: "${VAR:?}"`. Medido em 2026-11-19: com um
# `trap ... EXIT` já armado cujo último comando dá certo, o erro de expansão
# imprime a mensagem e o script sai com código **0** -- falha silenciosa
# exatamente onde o deploy decide se troca o app ou não.
exige() { [ -n "${!1:-}" ] || { log "ERRO: falta $1 ($2)"; exit 2; }; }
exige DB_CONTAINER "container do banco do ambiente"
psqlc() { docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NOME" -v ON_ERROR_STOP=1 "$@"; }

# Avisa o PostgREST para reler o esquema. Ele monta o cache de relacoes NA
# PARTIDA e nao repara em DDL depois disso: migration aplicada com o PostgREST
# ja de pe fica INVISIVEL para a API, que devolve 404 com
# `PGRST205 "Could not find the table ... in the schema cache"` -- enquanto o
# `/ready` dele segue em 200, porque so diz que o processo esta vivo.
#
# Nao e teoria: o staging passou 19 horas com o cache em 2 relacoes de 23
# (2026-11-27 07:09 -> 2026-11-28 02:31, quando o PostgREST subiu antes do banco
# terminar de migrar). Toda leitura de perfil dava 404, o login quebrava DEPOIS
# de autenticar com sucesso, e nenhum health check acusou.
#
# O canal e o `db-channel` do PostgREST, `pgrst` por padrao -- conferido no log
# do container: "listening for database notifications on the pgrst channel".
# Por isso basta o NOTIFY: nao e preciso reiniciar container nenhum.
#
# Roda em TODA saida de sucesso, inclusive quando nada estava pendente -- o
# cache pode estar velho sem existir migration nova, que foi exatamente o caso
# acima. NOTIFY nao altera dado, nao tranca nada e custa um ida-e-volta.
#
# Falhar aqui e FATAL de proposito: sem o aviso, a API serve esquema velho e o
# app quebra depois de o deploy ter dito "ok" -- o pior resultado possivel.
avisa_postgrest() {
  if ! psqlc -q -c "notify pgrst, 'reload schema';"; then
    log "ERRO: nao consegui avisar o PostgREST (notify pgrst) -- a API ficaria com esquema velho"
    exit 1
  fi
  log "PostgREST avisado para reler o esquema"
}

TMP=$(mktemp -d)
CRIADO=
limpar() {
  [ -n "$CRIADO" ] && docker rm -f "$CRIADO" > /dev/null 2>&1
  [ -n "$TMP" ] && rm -rf -- "$TMP"
  return 0
}
trap limpar EXIT

# ── de onde saem as migrations ──
if [ -n "$DE" ]; then
  cp -R "$DE" "$TMP/migrations"
else
  exige APP_IMAGEM "a imagem que o deploy pediu (tag ou digest)"
  CRIADO=migra-$$
  docker create --name "$CRIADO" "$APP_IMAGEM" > /dev/null
  docker cp "$CRIADO:/app/supabase/migrations" "$TMP/migrations"
  docker rm -f "$CRIADO" > /dev/null; CRIADO=
fi

ARQUIVOS=$(ls -1 "$TMP/migrations"/*.sql 2> /dev/null | sort || true)
[ -n "$ARQUIVOS" ] || { log "ERRO: nenhuma migration encontrada"; exit 1; }
log "migrations disponiveis: $(printf '%s\n' "$ARQUIVOS" | wc -l | tr -d ' ')"

# Versão é interpolada em SQL: validar ANTES, não confiar no nome do arquivo.
for f in $ARQUIVOS; do
  v=$(basename "$f"); v=${v%%_*}
  [[ $v =~ ^[0-9]{14}$ ]] || { log "ERRO: versao invalida em $(basename "$f")"; exit 1; }
done

# ── estado do banco: aplicação limpa, continuação, ou adoção? ──
ESTADO=$(psqlc -At -c "select
  coalesce((select count(*) from supabase_migrations.schema_migrations), -1)::text
  || ' ' || (select count(*) from pg_tables where schemaname = 'public')::text" 2> /dev/null \
  || echo "-1 $(psqlc -At -c "select count(*) from pg_tables where schemaname='public'")")
CONTROLE=${ESTADO%% *}; TABELAS=${ESTADO##* }
log "controle=$CONTROLE tabelas_public=$TABELAS"

if [ "$CONTROLE" -le 0 ] && [ "$TABELAS" -gt 0 ] && [ -z "$ADOTAR" ]; then
  log "ERRO: o banco ja tem $TABELAS tabelas em public e nenhuma linha de controle."
  log "      Reaplicar as migrations aqui e perigoso: parte delas roda calada"
  log "      (create or replace, drop if exists) ate alguma falhar, deixando o"
  log "      schema num estado que nenhum arquivo descreve."
  log "      Se o schema JA corresponde a estas migrations, rode uma vez com"
  log "      --adotar para gravar a linha de base sem executar nada."
  exit 1
fi

# ── o que ja foi aplicado ──
psqlc -q -c "create schema if not exists supabase_migrations;
             create table if not exists supabase_migrations.schema_migrations (
               version text primary key, inserted_at timestamptz not null default now());"
APLICADAS=" $(psqlc -At -c 'select version from supabase_migrations.schema_migrations;' | tr '\n' ' ')"

PENDENTES=
for f in $ARQUIVOS; do
  base=$(basename "$f"); versao=${base%%_*}
  case "$APLICADAS" in *" $versao "*) continue ;; esac
  PENDENTES="$PENDENTES $f"
done
if [ -z "$PENDENTES" ] && [ -z "$ADOTAR" ]; then
  # Avisa mesmo sem migration nova: o cache do PostgREST pode estar velho por
  # ele ter subido antes do banco terminar de migrar.
  log "nada pendente"; avisa_postgrest; exit 0
fi

# ── uma sessão só do psql: é o que faz o advisory lock valer ──
# O lock protege a chamada direta deste script; o flock do deploy.sh já
# protege o deploy. Sem ele, dois `migra.sh` simultâneos se atropelam.
{
  printf "select pg_advisory_lock(hashtext('complexo42-migrations'));\n"
  for f in ${ADOTAR:+$ARQUIVOS}${ADOTAR:-$PENDENTES}; do
    base=$(basename "$f"); versao=${base%%_*}
    printf "\\\\echo >>> %s\n" "$base"
    printf "begin;\n"
    # O insert vem ANTES do conteudo, de proposito. Ele é simples (sem `where
    # not exists`): se OUTRO processo aplicou esta versao entre a leitura e
    # agora, a chave primaria estoura aqui, a transacao aborta e o
    # ON_ERROR_STOP para tudo -- em vez de aplicar duas vezes. E se a migration
    # falhar, o rollback leva a linha de controle junto.
    printf "insert into supabase_migrations.schema_migrations(version) values ('%s');\n" "$versao"
    if [ -z "$ADOTAR" ]; then cat "$f"; printf "\n"; fi
    printf "commit;\n"
  done
} > "$TMP/apply.sql"

if [ -n "$ADOTAR" ]; then
  log "ADOCAO: gravando a linha de base sem executar nenhuma migration"
fi

if ! psqlc -q < "$TMP/apply.sql"; then
  log "ERRO: migrations falharam -- a que falhou nao deixou nada gravado"
  exit 1
fi

avisa_postgrest

log "fim"
exit 0
