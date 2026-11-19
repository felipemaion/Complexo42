#!/usr/bin/env bash
# Teste do migra.sh (issue #81). Dublê de `docker` que simula o create/cp da
# imagem e o psql: sem container, sem banco, sem rede.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/migra.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf "$BASE"' EXIT
mkdir -p "$BASE/bin" "$BASE/naimagem"
for v in 20260101000000_um 20260202000000_dois 20260303000000_tres; do
  printf -- "-- %s\ncreate table %s();\n" "$v" "${v##*_}" > "$BASE/naimagem/$v.sql"
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
      *"-At"*)  printf '%s\n' ${STUB_APLICADAS:-}; exit 0 ;;
      *"-q -c"*) exit 0 ;;
    esac
    sql=$(cat); printf '%s\n' "$sql" >> "$STUB_SQL"
    for m in ${STUB_FALHA_EM:-}; do
      case "$sql" in *"$m"*) exit 1 ;; esac
    done
    exit 0 ;;
esac
exit 0
DUBLE
chmod +x "$BASE/bin/docker"
export PATH="$BASE/bin:$PATH" STUB_CHAMADAS="$BASE/chamadas" STUB_SQL="$BASE/sql" \
       STUB_IMAGEM_DIR="$BASE/naimagem"

roda() { : > "$STUB_CHAMADAS"; : > "$STUB_SQL"
  APP_TAG=sha-abc1234 IMAGEM=ghcr.io/felipemaion/complexo42 DB_CONTAINER=stg-db-1 \
    bash "$SCRIPT" > "$BASE/saida" 2>&1; }

echo "== exigencias"
for v in APP_TAG IMAGEM DB_CONTAINER; do
  # define os tres e TIRA um: `env -u X X=v` devolveria a variavel na mesma linha
  ( export APP_TAG=sha-abc1234 IMAGEM=i DB_CONTAINER=c; unset "$v"; bash "$SCRIPT" ) > /dev/null 2>&1
  [ $? -ne 0 ] && r=0 || r=1; verifica "recusa rodar sem $v" $r
done

echo "== as migrations vem da imagem DAQUELA tag"
roda; verifica "execucao completa sai 0" $?
grep -q 'create --name migra-.* ghcr.io/felipemaion/complexo42:sha-abc1234' "$STUB_CHAMADAS" && r=0 || r=1
verifica "cria container a partir da imagem da tag pedida" $r
grep -q 'cp migra-.*:/app/supabase/migrations' "$STUB_CHAMADAS" && r=0 || r=1
verifica "copia as migrations de dentro da imagem" $r
grep -q '^rm -f migra-' "$STUB_CHAMADAS" && r=0 || r=1
verifica "e apaga o container temporario" $r

echo "== so o que esta pendente"
grep -q 'create table if not exists supabase_migrations.schema_migrations' "$STUB_CHAMADAS" && r=0 || r=1
verifica "garante a tabela de controle" $r
[ "$(grep -c '^begin;' "$STUB_SQL")" = 3 ] && r=0 || r=1
verifica "banco vazio: aplica as 3" $r
grep -q "values ('20260101000000')" "$STUB_SQL" && r=0 || r=1
verifica "grava a versao de cada uma na tabela de controle" $r

STUB_APLICADAS=$'20260101000000\n20260202000000' roda
[ "$(grep -c '^begin;' "$STUB_SQL")" = 1 ] && r=0 || r=1
verifica "com 2 ja aplicadas, aplica so a 3a" $r
grep -q '20260303000000' "$STUB_SQL" && r=0 || r=1
verifica "e e exatamente a que faltava" $r

echo "== uma transacao por migration"
grep -q 'commit;' "$STUB_SQL" && r=0 || r=1
verifica "cada migration vai entre begin e commit" $r

echo "== falha no meio aborta e nao segue"
STUB_FALHA_EM=20260202000000 roda
[ $? -ne 0 ] && r=0 || r=1; verifica "migration que falha derruba o script" $r
grep -q '20260303000000' "$STUB_SQL" && r=1 || r=0
verifica "e a SEGUINTE nem e tentada" $r
grep -q '20260101000000' "$STUB_SQL" && r=0 || r=1
verifica "mas a anterior, que passou, foi aplicada" $r

echo "== imagem sem migrations"
mkdir -p "$BASE/vazio"; STUB_IMAGEM_DIR="$BASE/vazio" roda
[ $? -ne 0 ] && r=0 || r=1; verifica "imagem sem migrations e erro, nao silencio" $r

echo "== repositorio publico"
grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}|/home/[a-z]|ubuntu@' "$SCRIPT" && r=1 || r=0
verifica "o script nao carrega IP, usuario nem caminho de servidor" $r

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
