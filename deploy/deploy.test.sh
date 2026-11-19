#!/usr/bin/env bash
# Teste do deploy.sh (issue #81). Dublês de `docker`, `flock` e `sleep`: roda
# no Mac e no runner Linux sem container, sem rede e sem servidor.
set -uo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$AQUI/deploy.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf "$BASE"' EXIT
mkdir -p "$BASE/bin" "$BASE/deploy"
# env do ambiente: repare no COMPOSE_PROJECT_NAME do SUPABASE, que e a armadilha
printf 'COMPOSE_PROJECT_NAME=complexo42stg\nANON_KEY=x\n' > "$BASE/deploy/env"
printf 'services: {app: {}}\n' > "$BASE/deploy/compose.yml"

cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CHAMADAS"
case "$1 $2" in
  "inspect -f") printf 'ghcr.io/felipemaion/complexo42:%s\n' "${STUB_ANTERIOR:-}"; exit 0 ;;
esac
case "$1" in
  run)  # o smoke
    n=$(( $(cat "$STUB_CONTA" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_CONTA"
    case "${STUB_SMOKE:-ok}" in
      ok) exit 0 ;;
      falha_sempre) exit 1 ;;
      falha_primeiro) [ "$n" -le "${STUB_FALHAS:-2}" ] && exit 1; exit 0 ;;
    esac ;;
esac
exit 0
DUBLE
printf '#!/bin/sh\nexit 0\n' > "$BASE/bin/flock"
printf '#!/bin/sh\nexit 0\n' > "$BASE/bin/sleep"
chmod +x "$BASE/bin"/*
export PATH="$BASE/bin:$PATH"
export STUB_CHAMADAS="$BASE/chamadas" STUB_CONTA="$BASE/conta"

roda() {  # roda <tag> ; o resto vem do ambiente
  : > "$STUB_CHAMADAS"; rm -f "$STUB_CONTA"
  PROJECT_DIR="$BASE/deploy" ENV_FILE="$BASE/deploy/env" \
  COMPOSE_APP="$BASE/deploy/compose.yml" APP_PROJETO=complexo42stg-app \
  REDE_PROXY=proxy ALVO_SAUDE=http://app:3000/api/healthz \
  MIGRA="$BASE/migra.sh" ESPERA_SMOKE=3 \
  bash "$SCRIPT" "$@" > "$BASE/saida" 2>&1
}
printf '#!/bin/sh\nexit 0\n' > "$BASE/migra.sh"; chmod +x "$BASE/migra.sh"

echo "== a tag e a unica superficie de ataque"
. "$SCRIPT" --funcoes; set +e
for t in sha-abc1234 sha-0123456789abcdef0123456789abcdef01234567 v2026.11.19 v2026.11.19.2 main; do
  tag_valida "$t"; [ $? = 0 ] || { verifica "aceita $t" 1; continue; }; verifica "aceita $t" 0
done
for t in 'sha-abc; rm -rf /' 'sha-abc$(id)' '../../etc' 'latest' '' 'sha-ZZZ' 'v2026-11-19'; do
  tag_valida "$t"; [ $? != 0 ] && verifica "recusa '$t'" 0 || verifica "recusa '$t'" 1
done

echo "== exigencias de ambiente"
( unset PROJECT_DIR; bash "$SCRIPT" sha-abc1234 ) > /dev/null 2>&1
[ $? -ne 0 ] && verifica "recusa rodar sem PROJECT_DIR" 0 || verifica "recusa rodar sem PROJECT_DIR" 1

echo "== caminho feliz"
roda sha-abc1234
verifica "deploy completo sai 0" $?
grep -q 'pull ghcr.io/felipemaion/complexo42:sha-abc1234' "$STUB_CHAMADAS" && r=0 || r=1
verifica "faz pull da tag pedida" $r
grep -q '^compose -p complexo42stg-app ' "$STUB_CHAMADAS" && r=0 || r=1
verifica "usa projeto Compose PROPRIO do app (-p explicito)" $r
grep -q 'remove-orphans' "$STUB_CHAMADAS" && r=1 || r=0
verifica "NUNCA passa --remove-orphans (derrubaria o banco)" $r
grep -q 'resultado=ok' "$BASE/deploy/data/logs/deploy.log" && r=0 || r=1
verifica "registra resultado e tempo no deploy.log" $r

echo "== migration que falha nao troca o app"
printf '#!/bin/sh\nexit 1\n' > "$BASE/migra.sh"
roda sha-abc1234
[ $? -ne 0 ] && r=0 || r=1
verifica "migration falhando derruba o deploy" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e o app NAO chega a subir" $r
grep -q 'resultado=migrations_falharam' "$BASE/deploy/data/logs/deploy.log" && r=0 || r=1
verifica "e o motivo fica no log" $r
printf '#!/bin/sh\nexit 0\n' > "$BASE/migra.sh"

echo "== smoke que falha volta para a tag anterior"
STUB_ANTERIOR=sha-9999999 STUB_SMOKE=falha_primeiro STUB_FALHAS=3 roda sha-abc1234
[ $? -ne 0 ] && r=0 || r=1
verifica "smoke falhando derruba o deploy" $r
grep -c 'up -d' "$STUB_CHAMADAS" | grep -q '^2$' && r=0 || r=1
verifica "sobe duas vezes: a nova e a volta" $r
grep -q 'resultado=rollback_ok=sha-9999999' "$BASE/deploy/data/logs/deploy.log" && r=0 || r=1
verifica "registra o rollback com a tag de destino" $r

echo "== sem tag anterior nao ha para onde voltar"
STUB_ANTERIOR= STUB_SMOKE=falha_sempre roda sha-abc1234
grep -q 'resultado=smoke_falhou_sem_rollback' "$BASE/deploy/data/logs/deploy.log" && r=0 || r=1
verifica "diz claramente que nao havia rollback possivel" $r

echo "== repositorio publico"
grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}|/home/[a-z]|ubuntu@' "$SCRIPT" && r=1 || r=0
verifica "o script nao carrega IP, usuario nem caminho de servidor" $r
grep -q 'flock' "$SCRIPT" && r=0 || r=1
verifica "ha trava contra deploys simultaneos" $r

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
