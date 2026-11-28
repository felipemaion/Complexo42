#!/usr/bin/env bash
# Teste de restauração (issue #84). "Backup que nunca foi restaurado não conta."
#
# Sobe um Postgres DESCARTÁVEL, decifra o backup, restaura, conta as linhas de
# controle e apaga tudo. Não toca o banco do ambiente em momento algum.
#
# A chave PRIVADA entra só aqui, só durante o teste, e o script não a copia,
# não a imprime e não a apaga -- quem manda nela é o operador (ADR 0003 §7).
#
# Uso: ./restore-test.sh <arquivo.age> <identidade-age>
#      ./restore-test.sh --do-remoto <identidade-age>
#
# INITDB_DIR=<dir do deploy>/initdb (padrão: ./initdb ao lado deste script, se existir): o banco
# descartável nasce com o MESMO initdb do servidor. Sem ele faltam os papéis (anon, authenticated...)
# que as políticas de RLS citam, e o pg_restore para no primeiro `create policy ... to authenticated`.
# E o initdb já cria o schema `auth` (vazio): por isso `--clean --if-exists`, que derruba o que o dump
# traz antes de recriar, sem erro para o que não existe. Um volume novo do servidor tem o mesmo initdb.
#
# MINIMOS="perfis=1 unidades=1 ..." (opcional) reprova se alguma contagem de controle vier abaixo
# do mínimo: um banco restaurado vazio não é "restauração ok". REGISTRO=<arquivo> (opcional,
# ex.: data/logs/backup.log) recebe uma linha com o resultado, o tempo e as contagens (sem dado
# pessoal: só números).
#
# O modo --do-remoto BAIXA o backup mais novo do destino fora da VPS e restaura
# esse arquivo. É o teste que vale: um arquivo local restaurável não prova que
# a cópia remota existe, chegou inteira e pode ser recuperada.
set -euo pipefail
umask 077

AQUI=$(cd "$(dirname "$0")" && pwd)
BAIXADO=
if [ "${1:-}" = "--do-remoto" ]; then
  IDENT=${2:?uso: restore-test.sh --do-remoto <identidade-age>}
  BAIXADO=$(mktemp -d)
  echo "== baixando do destino fora da VPS"
  # O caminho do arquivo vem pelo stdout do enviar-backup.sh; o log dele sai
  # pelo stderr justamente para esta linha funcionar.
  ARQ=$("$AQUI/enviar-backup.sh" --baixar-ultimo "$BAIXADO")
else
  ARQ=${1:?uso: restore-test.sh <arquivo.age|--do-remoto> <identidade-age>}
  IDENT=${2:?falta o arquivo de identidade (chave privada age)}
fi
# Mesma imagem do ambiente, por fidelidade: restaurar num Postgres diferente
# testa outra coisa. Fixada por digest, como no compose.
IMAGEM=${IMAGEM:-supabase/postgres:17.12.0.001@sha256:2543d8fb3889ff2ee514af39496f67c30edd1f1e0da923a560e7930d2f59ca16}
AGE_IMAGEM=${AGE_IMAGEM:-}
MINIMOS=${MINIMOS:-}
REGISTRO=${REGISTRO:-}
INITDB_DIR=${INITDB_DIR:-}
[ -z "$INITDB_DIR" ] && [ -d "$AQUI/initdb" ] && INITDB_DIR=$AQUI/initdb
NOME=restore-test-$$
SENHA=$(head -c 30 /dev/urandom | od -An -tx1 | tr -d ' \n')

[ -r "$ARQ" ]   || { echo "ERRO: nao consigo ler $ARQ" >&2; exit 2; }
[ -r "$IDENT" ] || { echo "ERRO: nao consigo ler a identidade" >&2; exit 2; }
for par in $MINIMOS; do
  [[ $par =~ ^[a-z_]+=[0-9]+$ ]] || { echo "ERRO: MINIMOS mal formado ($par); use rotulo=numero" >&2; exit 2; }
done

# Uma linha por teste no registro (o mesmo log do backup), para o resultado mensal ficar anotado.
registra() { [ -z "$REGISTRO" ] || printf '%s restore-test %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$REGISTRO"; }

decifrador() {
  if command -v age > /dev/null 2>&1; then
    age -d -i "$IDENT"
  elif [ -n "$AGE_IMAGEM" ]; then
    # a identidade entra pelo stdin do container, nunca por argumento (que
    # apareceria em `ps` para qualquer usuário da máquina)
    docker run --rm -i -v "$(cd "$(dirname "$IDENT")" && pwd)":/k:ro \
      "$AGE_IMAGEM" age -d -i "/k/$(basename "$IDENT")"
  else
    echo "ERRO: sem \`age\` no host e sem AGE_IMAGEM" >&2
    exit 2
  fi
}

limpar() {
  docker rm -f "$NOME" > /dev/null 2>&1 || true
  # o que foi baixado para o teste nao fica no disco depois dele
  [ -n "$BAIXADO" ] && rm -rf -- "$BAIXADO"
  return 0
}
trap limpar EXIT

echo "== subindo Postgres descartavel"
INITDB=()
if [ -n "$INITDB_DIR" ]; then
  [ -d "$INITDB_DIR" ] || { echo "ERRO: INITDB_DIR nao e diretorio" >&2; exit 2; }
  # As senhas dos papéis são descartáveis como o banco: ninguém se conecta com elas.
  INITDB=(-v "$(cd "$INITDB_DIR" && pwd):/docker-entrypoint-initdb.d:ro"
          -e AUTHENTICATOR_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
          -e AUTH_ADMIN_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')")
else
  echo "   AVISO: sem INITDB_DIR; o banco descartavel nao tem os papeis do servidor" >&2
fi
docker run -d --name "$NOME" -e POSTGRES_PASSWORD="$SENHA" \
  -e POSTGRES_DB=postgres "${INITDB[@]+"${INITDB[@]}"}" "$IMAGEM" \
  postgres -c listen_addresses=* > /dev/null

# Esperar o banco aceitar conexão de verdade (o mesmo erro da armadilha 52:
# `pg_isready` responde antes de o servidor estar pronto para consultas).
echo -n "   aguardando"
for i in $(seq 1 60); do
  if docker exec -e PGPASSWORD="$SENHA" "$NOME" \
       psql -h 127.0.0.1 -U supabase_admin -d postgres -c 'select 1' > /dev/null 2>&1; then
    echo " pronto em ${i}s"; break
  fi
  [ "$i" = 60 ] && { echo; echo "ERRO: banco nao ficou pronto" >&2; exit 1; }
  printf '.'; sleep 1
done

echo "== decifrando e restaurando"
INICIO=$(date +%s)
set +e
decifrador < "$ARQ" \
  | docker exec -i -e PGPASSWORD="$SENHA" "$NOME" \
      pg_restore -U supabase_admin -d postgres --no-owner --no-privileges \
      --clean --if-exists --exit-on-error > /tmp/restore-$$.log 2>&1
ESTADO=("${PIPESTATUS[@]}")
set -e
FIM_T=$(date +%s)
SEGUNDOS=$((FIM_T - INICIO))

if [ "${ESTADO[0]}" -ne 0 ]; then
  echo "ERRO: falha ao decifrar (chave errada?)" >&2
  registra "FALHOU decifrar"; rm -f /tmp/restore-$$.log; exit 1
fi
if [ "${ESTADO[1]}" -ne 0 ]; then
  echo "ERRO: pg_restore falhou:" >&2
  tail -20 /tmp/restore-$$.log >&2
  registra "FALHOU pg_restore"; rm -f /tmp/restore-$$.log; exit 1
fi
rm -f /tmp/restore-$$.log

echo "== contagens de controle"
CONTAGENS=$(docker exec -e PGPASSWORD="$SENHA" "$NOME" \
  psql -h 127.0.0.1 -U supabase_admin -d postgres -At -F' ' -v ON_ERROR_STOP=1 -c "
    select 'perfis',    count(*) from public.profiles
    union all select 'unidades', count(*) from public.units
    union all select 'vinculos', count(*) from public.unit_members
    union all select 'casas',    count(*) from public.house_members
    union all select 'papeis',   count(*) from public.role_assignments
    union all select 'municipios', count(*) from public.municipalities;
  ") || { echo "ERRO: as contagens falharam (tabela ausente no restaurado?)" >&2; registra "FALHOU contagens"; exit 1; }
printf '%s\n' "$CONTAGENS" | while read -r rotulo n; do printf '   %-12s %s\n' "$rotulo" "$n"; done
RESUMO=$(printf '%s\n' "$CONTAGENS" | tr ' ' '=' | tr '\n' ' ')

# Restaurou, mas restaurou o QUÊ? Abaixo do mínimo, o teste reprova.
ABAIXO=
for par in $MINIMOS; do
  rotulo=${par%%=*}; minimo=${par#*=}
  n=$(printf '%s\n' "$CONTAGENS" | awk -v r="$rotulo" '$1 == r { print $2 }')
  if [ -z "$n" ]; then
    echo "ERRO: MINIMOS cita '$rotulo', que nao e contagem de controle" >&2; exit 2
  fi
  [ "$n" -ge "$minimo" ] || ABAIXO="$ABAIXO $rotulo=$n<$minimo"
done
if [ -n "$ABAIXO" ]; then
  echo "ERRO: contagem abaixo do minimo:$ABAIXO" >&2
  registra "FALHOU minimos$ABAIXO segundos=$SEGUNDOS"; exit 1
fi

registra "ok segundos=$SEGUNDOS $RESUMO"
echo
echo "RESTAURACAO OK em ${SEGUNDOS}s"
