#!/usr/bin/env bash
# Teste do deploy.sh (issue #81). Dublês de docker/flock/sleep: roda no Mac e
# no runner Linux sem container, sem rede e sem servidor.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/deploy.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf "$BASE"' EXIT
mkdir -p "$BASE/bin" "$BASE/deploy/data/logs"
printf 'COMPOSE_PROJECT_NAME=complexo42stg\n' > "$BASE/deploy/env"   # o do SUPABASE: a armadilha
printf 'services: {app: {}}\n' > "$BASE/deploy/compose.yml"
printf '#!/bin/sh\nexit 0\n' > "$BASE/migra.sh"; chmod +x "$BASE/migra.sh"

cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf 'APP_IMAGEM=%s %s\n' "${APP_IMAGEM:-}" "$*" >> "$STUB_CHAMADAS"
[ "$1 $2" = "compose -p" ] && case "$*" in *" ps -q app") echo cid123; exit 0 ;; esac
[ "$1 $2" = "inspect -f" ] && { printf '%s\n' "${STUB_ANTERIOR-$ANTERIOR_PADRAO}"; exit 0; }
case "$1" in
  pull) exit "${STUB_PULL:-0}" ;;
  run) n=$(( $(cat "$STUB_CONTA" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_CONTA"
       case "${STUB_SMOKE:-ok}" in ok) exit 0 ;; falha_sempre) exit 1 ;;
         falha_primeiro) [ "$n" -le "${STUB_FALHAS:-3}" ] && exit 1; exit 0 ;; esac ;;
esac
case "$*" in *"up -d"*) exit "${STUB_UP:-0}" ;; esac
exit 0
DUBLE
printf '#!/bin/sh\nexit ${STUB_FLOCK:-0}\n' > "$BASE/bin/flock"
printf '#!/bin/sh\nexit 0\n' > "$BASE/bin/sleep"
chmod +x "$BASE/bin"/*
ANT=ghcr.io/felipemaion/complexo42@sha256:$(printf '9%.0s' $(seq 1 64))
export PATH="$BASE/bin:$PATH" STUB_CHAMADAS="$BASE/chamadas" STUB_CONTA="$BASE/conta" ANTERIOR_PADRAO="$ANT"

escreve_config() {
  cat > "$BASE/deploy.conf" << CFG
PROJECT_DIR=$BASE/deploy
ENV_FILE=$BASE/deploy/env
COMPOSE_APP=$BASE/deploy/compose.yml
APP_PROJETO=complexo42stg-app
REDE_PROXY=proxy
ALVO_SAUDE=http://app:3000/api/healthz
MIGRA=$BASE/migra.sh
SMOKE_IMAGEM=curlimages/curl@sha256:abc
ESPERA_SMOKE=3
TRAVA=$BASE/deploy.lock
CFG
  [ -n "${1:-}" ] && sed -i.bak "/^$1=/d" "$BASE/deploy.conf"
  return 0
}
roda() { : > "$STUB_CHAMADAS"; rm -f "$STUB_CONTA"; bash "$SCRIPT" --config "$BASE/deploy.conf" "$@" > "$BASE/saida" 2>&1; }
LOG="$BASE/deploy/data/logs/deploy.log"
escreve_config

echo "== so digest no caminho normal; tag so por emergencia"
. "$SCRIPT" --funcoes; set +e
D=sha256:$(printf 'a%.0s' $(seq 1 64))
referencia_valida "$D" && verifica "aceita digest" 0 || verifica "aceita digest" 1
referencia_valida "emergencia:sha-abc1234" && verifica "aceita emergencia:sha-*" 0 || verifica "aceita emergencia:sha-*" 1
referencia_valida "emergencia:v2026.11.19" && verifica "aceita emergencia:v*" 0 || verifica "aceita emergencia:v*" 1
# O ponto da #161: tag pura NAO entra pelo caminho normal.
for t in sha-abc1234 v2026.11.19 main emergencia:main emergencia:latest; do
  referencia_valida "$t" && verifica "recusa tag pura/movel '$t'" 1 || verifica "recusa tag pura/movel '$t'" 0; done
# digest malformado
D63=sha256:$(printf 'a%.0s' $(seq 1 63)); D65=sha256:$(printf 'a%.0s' $(seq 1 65))
DMAI=sha256:$(printf 'A%.0s' $(seq 1 64))
for t in "$D63" "$D65" "$DMAI" "sha256:" "$D extra" "ghcr.io/felipemaion/complexo42@$D"; do
  referencia_valida "$t" && verifica "recusa digest invalido (${#t} chars)" 1 || verifica "recusa digest invalido (${#t} chars)" 0; done
HOSTIL=$'sha-abc1234\nrm -rf /'
referencia_valida "$HOSTIL" && verifica "recusa referencia com QUEBRA DE LINHA" 1 || verifica "recusa referencia com QUEBRA DE LINHA" 0
DNL=$D$'\nid'
referencia_valida "$DNL" && verifica "recusa digest com QUEBRA DE LINHA" 1 || verifica "recusa digest com QUEBRA DE LINHA" 0

[ "$(imagem_de "$D")" = "ghcr.io/felipemaion/complexo42@$D" ] && r=0 || r=1; verifica "digest vira repo@digest" $r
[ "$(imagem_de emergencia:sha-abc1234)" = "ghcr.io/felipemaion/complexo42:sha-abc1234" ] && r=0 || r=1; verifica "emergencia vira repo:tag" $r

echo "== para onde o rollback aceita voltar"
imagem_reversivel "ghcr.io/felipemaion/complexo42@$D" && verifica "volta para digest do NOSSO repo" 0 || verifica "volta para digest do NOSSO repo" 1
for a in "ghcr.io/felipemaion/complexo42:latest" "ghcr.io/felipemaion/complexo42:main" "ghcr.io/felipemaion/complexo42:sha-abc1234" "ghcr.io/felipemaion/complexo42" "ghcr.io/felipemaion/complexo42:" \
         "outro.registro/x@$D" "host:5000/complexo42@$D" "x@sha256:abc" ""; do
  imagem_reversivel "$a" && verifica "NAO volta para '${a:0:34}'" 1 || verifica "NAO volta para '${a:0:34}'" 0; done

DIG=sha256:$(printf 'b%.0s' $(seq 1 64))
echo "== a interface e argumento, nao ambiente"
roda "$HOSTIL"; [ $? = 2 ] && r=0 || r=1; verifica "tag hostil por argumento sai 2" $r
[ ! -s "$STUB_CHAMADAS" ] && r=0 || r=1; verifica "e NENHUM docker e chamado" $r
: > "$STUB_CHAMADAS"; SSH_ORIGINAL_COMMAND="$DIG" bash "$SCRIPT" --config "$BASE/deploy.conf" > /dev/null 2>&1
[ $? -ne 0 ] && [ ! -s "$STUB_CHAMADAS" ] && r=0 || r=1
verifica "NAO le SSH_ORIGINAL_COMMAND (nao sobrevive ao sudo)" $r
bash "$SCRIPT" "$DIG" > /dev/null 2>&1; [ $? = 2 ] && r=0 || r=1; verifica "exige --config" $r
roda "$DIG" extra; [ $? = 2 ] && r=0 || r=1; verifica "recusa argumento a mais" $r
bash "$SCRIPT" --config "$BASE/naoexiste" "$DIG" > /dev/null 2>&1; [ $? = 2 ] && r=0 || r=1
verifica "recusa config inexistente" $r
for v in PROJECT_DIR ENV_FILE COMPOSE_APP APP_PROJETO REDE_PROXY ALVO_SAUDE MIGRA SMOKE_IMAGEM; do
  escreve_config "$v"; roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
  verifica "recusa config sem $v" $r
done
escreve_config

echo "== caminho feliz"
roda "$DIG"; verifica "deploy completo sai 0" $?
grep -q "pull ghcr.io/felipemaion/complexo42@$DIG" "$STUB_CHAMADAS" && r=0 || r=1
verifica "faz pull por repo@digest" $r
grep -q 'compose -p complexo42stg-app ' "$STUB_CHAMADAS" && r=0 || r=1
verifica "usa projeto Compose PROPRIO do app" $r
grep -q 'remove-orphans' "$STUB_CHAMADAS" && r=1 || r=0
verifica "NUNCA passa --remove-orphans (derrubaria o banco)" $r
grep -q "APP_IMAGEM=ghcr.io/felipemaion/complexo42@$DIG compose.*up -d" "$STUB_CHAMADAS" && r=0 || r=1
verifica "sobe com APP_IMAGEM = a imagem nova" $r
tail -1 "$LOG" | grep -q 'resultado=ok' && r=0 || r=1; verifica "registra ok no deploy.log" $r

echo "== falhas, cada uma com seu registro"
STUB_PULL=1 roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1; verifica "pull falhando derruba o deploy" $r
tail -1 "$LOG" | grep -q 'resultado=pull_falhou' && r=0 || r=1; verifica "e o pull falhado fica no log" $r

printf '#!/bin/sh\nexit 1\n' > "$BASE/migra.sh"
roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1; verifica "migration falhando derruba o deploy" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=1 || r=0; verifica "e o app NAO chega a subir" $r
tail -1 "$LOG" | grep -q 'resultado=migrations_falharam' && r=0 || r=1; verifica "e o motivo fica no log" $r
printf '#!/bin/sh\nexit 0\n' > "$BASE/migra.sh"

STUB_UP=1 roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1; verifica "up falhando derruba o deploy" $r
tail -1 "$LOG" | grep -qE 'resultado=rollback' && r=0 || r=1; verifica "e o up falhado tenta o rollback" $r

echo "== smoke que falha volta para a tag anterior"
STUB_SMOKE=falha_primeiro STUB_FALHAS=3 roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
verifica "smoke falhando derruba o deploy" $r
grep -q "APP_IMAGEM=$ANT compose.*up -d" "$STUB_CHAMADAS" && r=0 || r=1
verifica "e sobe de novo com APP_IMAGEM = a ANTERIOR" $r
tail -1 "$LOG" | grep -q "resultado=rollback_ok=$ANT" && r=0 || r=1
verifica "registra o rollback com a tag de destino" $r

STUB_ANTERIOR= STUB_SMOKE=falha_sempre roda "$DIG"
tail -1 "$LOG" | grep -q 'resultado=smoke_falhou_sem_rollback' && r=0 || r=1
verifica "sem tag anterior, diz que nao havia para onde voltar" $r

echo "== um deploy por vez"
STUB_FLOCK=1 roda "$DIG"; [ $? = 3 ] && r=0 || r=1
verifica "trava ocupada sai 3 sem fazer nada" $r
grep -q 'pull' "$STUB_CHAMADAS" && r=1 || r=0; verifica "e nem chega a fazer pull" $r

echo "== repositorio publico"
grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}|/home/[a-z]|ubuntu@' "$SCRIPT" && r=1 || r=0
verifica "o script nao carrega IP, usuario nem caminho de servidor" $r

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
