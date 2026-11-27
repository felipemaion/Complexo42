#!/usr/bin/env bash
# Teste do migra.sh com dublê de `docker` (issue #81): composição do SQL,
# filtro do que está pendente e a guarda de adoção -- sem banco e sem rede.
# O que só um banco de verdade prova (o rollback do DDL) está no
# migra-integracao.test.sh.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/migra.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT
mkdir -p "$BASE/bin" "$BASE/naimagem"
for v in 20260101000000_um 20260202000000_dois 20260303000000_tres; do
  printf -- "create table %s();\n" "${v##*_}" > "$BASE/naimagem/$v.sql"
done

cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CHAMADAS"
case "$1" in
  create) exit 0 ;;
  cp) mkdir -p "$3"; cp "$STUB_IMAGEM_DIR"/*.sql "$3"/ 2>/dev/null; exit 0 ;;
  rm) exit 0 ;;
  exec)
    case "$*" in
      *pg_tables*) printf '%s\n' "${STUB_ESTADO:-0 0}"; exit 0 ;;
      *"select version from"*) printf '%s\n' ${STUB_APLICADAS:-}; exit 0 ;;
      *"-q -c"*) exit 0 ;;
    esac
    sql=$(cat); printf '%s\n' "$sql" > "$STUB_SQL"
    # A falha casa pelo NOME DO ARQUIVO no marcador \echo, nao por comentario:
    # comentario some se alguem reescrever a migration.
    for m in ${STUB_FALHA_EM:-}; do
      case "$sql" in *">>> $m"*) exit 1 ;; esac
    done
    exit 0 ;;
esac
exit 0
DUBLE
chmod +x "$BASE/bin/docker"
export PATH="$BASE/bin:$PATH" STUB_CHAMADAS="$BASE/chamadas" STUB_SQL="$BASE/sql" \
       STUB_IMAGEM_DIR="$BASE/naimagem"

roda() { : > "$STUB_CHAMADAS"; : > "$STUB_SQL"
  APP_IMAGEM=ghcr.io/felipemaion/complexo42:sha-abc1234 DB_CONTAINER=stg-db-1 \
    bash "$SCRIPT" "$@" > "$BASE/saida" 2>&1; }

echo "== exigencias"
for v in APP_IMAGEM DB_CONTAINER; do
  ( export APP_IMAGEM=i:t DB_CONTAINER=c; unset "$v"; bash "$SCRIPT" ) > /dev/null 2>&1
  [ $? -ne 0 ] && r=0 || r=1; verifica "recusa rodar sem $v" $r
done
( export DB_CONTAINER=c; bash "$SCRIPT" --de /tmp --lixo ) > /dev/null 2>&1
[ $? = 2 ] && r=0 || r=1; verifica "recusa argumento desconhecido" $r

echo "== as migrations vem da imagem DAQUELA tag"
roda; verifica "execucao completa sai 0" $?
grep -q 'create --name migra-.* ghcr.io/felipemaion/complexo42:sha-abc1234' "$STUB_CHAMADAS" && r=0 || r=1
verifica "cria container da imagem da tag pedida" $r
grep -q 'cp migra-.*:/app/supabase/migrations' "$STUB_CHAMADAS" && r=0 || r=1
verifica "copia as migrations de dentro da imagem" $r
grep -q '^rm -f migra-' "$STUB_CHAMADAS" && r=0 || r=1
verifica "e apaga o container temporario" $r

echo "== a versao e interpolada em SQL: validada antes"
printf 'select 1;\n' > "$BASE/naimagem/naoevalida_x.sql"
roda; [ $? -ne 0 ] && r=0 || r=1
verifica "nome de arquivo sem versao de 14 digitos e recusado" $r
rm -f "$BASE/naimagem/naoevalida_x.sql"

echo "== composicao do SQL"
roda
grep -q 'pg_advisory_lock' "$STUB_SQL" && r=0 || r=1
verifica "toma advisory lock (migra.sh pode ser chamado sozinho)" $r
[ "$(grep -c '^begin;' "$STUB_SQL")" = 3 ] && r=0 || r=1
verifica "banco vazio: as 3 entram" $r
grep -q "values ('20260101000000')" "$STUB_SQL" && r=0 || r=1
verifica "cada uma grava a propria versao" $r
[ "$(grep -c 'commit;' "$STUB_SQL")" = 3 ] && r=0 || r=1
verifica "cada uma entre begin e commit" $r

echo "== so o que esta pendente entra no fluxo"
STUB_APLICADAS=$'20260101000000\n20260202000000' roda
[ "$(grep -c '^begin;' "$STUB_SQL")" = 1 ] && r=0 || r=1
verifica "com 2 aplicadas, so a 3a entra" $r
grep -q '20260303000000' "$STUB_SQL" && r=0 || r=1
verifica "e e exatamente a que faltava" $r
grep -q 'create table um()' "$STUB_SQL" && r=1 || r=0
verifica "o CORPO da ja aplicada NAO entra (nao reexecuta)" $r

STUB_APLICADAS=$'20260101000000\n20260202000000\n20260303000000' roda
grep -q 'nada pendente' "$BASE/saida" && r=0 || r=1
verifica "tudo aplicado: diz 'nada pendente' e sai 0" $r

echo "== falha casa pelo nome do arquivo"
STUB_FALHA_EM=20260202000000_dois.sql roda
[ $? -ne 0 ] && r=0 || r=1; verifica "psql falhando derruba o script" $r

echo "== adocao de banco ja migrado"
STUB_ESTADO="-1 12" roda
[ $? -ne 0 ] && r=0 || r=1; verifica "sem controle e com tabelas: RECUSA" $r
grep -q 'adotar' "$BASE/saida" && r=0 || r=1; verifica "e diz o que fazer" $r
STUB_ESTADO="-1 12" roda --adotar
verifica "--adotar sai 0" $?
grep -q "values ('20260101000000')" "$STUB_SQL" && r=0 || r=1
verifica "grava a linha de base" $r
grep -q 'create table um()' "$STUB_SQL" && r=1 || r=0
verifica "e NAO executa o corpo de nenhuma" $r
STUB_ESTADO="0 0" roda
verifica "banco vazio nao precisa de --adotar" $?

echo "== repositorio publico"
grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}|/home/[a-z]|ubuntu@' "$SCRIPT" && r=1 || r=0
verifica "o script nao carrega IP, usuario nem caminho de servidor" $r

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
