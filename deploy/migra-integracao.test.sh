#!/usr/bin/env bash
# Teste de INTEGRAÇÃO do migra.sh (issue #81): Postgres de verdade, migration
# que quebra no meio. É o que o teste com dublê não consegue provar -- que a
# transação realmente desfaz o DDL e a linha de controle juntos.
#
# Pula limpo se não houver Docker em funcionamento; no CI há.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/migra.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

docker info > /dev/null 2>&1 || { echo "sem Docker em funcionamento -- integracao PULADA"; exit 0; }

IMG=${PG_IMAGEM:-postgres:17-alpine}
NOME=migra-it-$$-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')
BASE=$(mktemp -d)
limpar() { docker rm -f "$NOME" > /dev/null 2>&1; rm -rf -- "$BASE"; return 0; }
trap limpar EXIT

mkdir -p "$BASE/m"
printf 'create table alfa(id int);\n'              > "$BASE/m/20260101000000_alfa.sql"
printf 'create table beta(id int);\nselect 1/0;\n' > "$BASE/m/20260202000000_beta.sql"

echo "== subindo Postgres descartavel ($IMG)"
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=x "$IMG" > /dev/null
# Esperar por TCP, nao pelo socket: a imagem oficial sobe um servidor
# TEMPORARIO durante o initdb que escuta SO no socket Unix e e derrubado em
# seguida. Uma consulta pelo socket pode dar "pronto" contra ele, e o teste
# segue contra um banco que esta reiniciando -- falha intermitente, que foi
# exatamente o que apareceu no CI. Pelo TCP isso nao acontece.
pronto=0
for i in $(seq 1 90); do
  if docker exec -e PGPASSWORD=x "$NOME" psql -h 127.0.0.1 -U postgres -c 'select 1' > /dev/null 2>&1; then
    pronto=$((pronto + 1))
    # Duas leituras seguidas: uma so ainda poderia pegar a janela entre o fim
    # do initdb e o restart definitivo.
    [ "$pronto" -ge 2 ] && { echo "   pronto em ${i}s"; break; }
  else
    pronto=0
  fi
  [ "$i" = 90 ] && { echo "banco nao ficou pronto em 90s"; docker logs "$NOME" | tail -20; exit 1; }
  sleep 1
done

q() { docker exec -i -e PGPASSWORD=x "$NOME" psql -h 127.0.0.1 -U postgres -At -c "$1" 2>/dev/null; }
corre() { DB_CONTAINER="$NOME" DB_USER=postgres DB_NOME=postgres bash "$SCRIPT" --de "$BASE/m" "$@"; }

echo "== migration que quebra no meio"
corre > "$BASE/saida" 2>&1; [ $? -ne 0 ] && r=0 || r=1
verifica "a execucao falha" $r
[ "$(q "select to_regclass('public.alfa') is not null")" = t ] && r=0 || r=1
verifica "a migration ANTERIOR, que passou, ficou aplicada" $r
[ "$(q "select count(*) from supabase_migrations.schema_migrations where version='20260101000000'")" = 1 ] && r=0 || r=1
verifica "e a linha de controle dela existe" $r
[ "$(q "select to_regclass('public.beta') is null")" = t ] && r=0 || r=1
verifica "o DDL da que QUEBROU foi desfeito" $r
[ "$(q "select count(*) from supabase_migrations.schema_migrations where version='20260202000000'")" = 0 ] && r=0 || r=1
verifica "e a linha de controle dela NAO ficou" $r

echo "== idempotencia"
rm -f "$BASE/m/20260202000000_beta.sql"
corre > "$BASE/saida2" 2>&1; verifica "rodar de novo sem pendencia sai 0" $?
grep -q 'nada pendente' "$BASE/saida2" && r=0 || r=1
verifica "e diz que nao havia nada pendente" $r

echo "== adocao de banco ja migrado"
q "drop schema supabase_migrations cascade" > /dev/null
corre > "$BASE/saida3" 2>&1; [ $? -ne 0 ] && r=0 || r=1
verifica "banco com tabelas e sem controle: RECUSA" $r
grep -q 'adotar' "$BASE/saida3" && r=0 || r=1
verifica "e diz o que fazer (--adotar)" $r
corre --adotar > "$BASE/saida4" 2>&1; verifica "--adotar sai 0" $?
[ "$(q "select count(*) from supabase_migrations.schema_migrations")" = 1 ] && r=0 || r=1
verifica "grava a linha de base" $r
[ "$(q "select to_regclass('public.beta') is null")" = t ] && r=0 || r=1
verifica "e NAO executa nada (beta continua inexistente)" $r

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
