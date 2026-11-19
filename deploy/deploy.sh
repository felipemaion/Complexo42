#!/usr/bin/env bash
# Deploy do app (issue #81, ADR 0009 §3). Versão de REFERÊNCIA: o staging roda
# esta; a produção roda a cópia do repositório de infraestrutura.
#
# RODA COMO ROOT, por sudo, a partir de um forced-command. Isso define todo o
# desenho de segurança abaixo:
#
#   - A TAG é o único dado que atravessa o SSH, e chega por ARGUMENTO. Não se
#     lê SSH_ORIGINAL_COMMAND aqui: ele não sobrevive ao sudo (env_reset).
#   - Os CAMINHOS vêm de um arquivo de configuração do root, nunca do
#     ambiente. Caminho vindo do ambiente, com sudo que preserva env, é
#     execução arbitrária como root; e com env_reset o script nem rodaria.
#   - Tudo que este script EXECUTA ou INTERPRETA (migra.sh, compose) é
#     conferido: tem de ser do root e não gravável por grupo/outros. Sem isso,
#     quem escreve no diretório de deploy escala para root trocando um arquivo.
#
# As conferências de dono só valem quando o processo é root — fora disso não
# há privilégio para escalar, e é assim que o teste roda sem ser root.
#
# Uso: deploy.sh --config <arquivo> <tag>
set -euo pipefail
umask 077
SOU_ROOT=0; [ "$(id -u)" -eq 0 ] && SOU_ROOT=1

# PATH fixo SÓ como root: é aí que um PATH herdado vira execução arbitrária
# com privilégio. Fora disso herdamos o PATH de quem chamou, que é o que
# permite ao teste pôr dublês de `docker` e `flock` na frente -- e o `flock`
# nem existe no macOS, onde o teste também roda.
if [ "$SOU_ROOT" = 1 ]; then
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH
fi

IMAGEM_PADRAO=ghcr.io/felipemaion/complexo42

agora() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s %s\n' "$(agora)" "$*" >&2; }

# ── a tag, única entrada vinda de fora ──
# `[[ =~ ]]` e NÃO `grep`: grep casa por LINHA, então "sha-abc1234\nrm -rf /"
# passaria pelo ^...$ olhando só a primeira linha. Medido.
tag_valida() {
  [[ $1 =~ ^sha-[0-9a-f]{7,40}$ ]] && return 0
  [[ $1 =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]] && return 0
  [[ $1 == main ]] && return 0
  return 1
}

# Tag para a qual FAZ SENTIDO voltar: `main` é móvel (hoje aponta para outro
# commit), e imagem presa por digest não tem tag para reusar.
tag_reversivel() { tag_valida "$1" && [ "$1" != main ]; }

modo_e_dono() { stat -c '%u %a' "$1" 2> /dev/null || stat -f '%u %Lp' "$1"; }

confere() { # confere <caminho> <descricao> [segredo]
  local f=$1 d=$2 seg=${3:-} info dono modo g o
  [ -e "$f" ] || { log "ERRO: $d nao existe: $f"; exit 2; }
  [ -L "$f" ] && { log "ERRO: $d e um link simbolico: $f"; exit 2; }
  [ "$SOU_ROOT" = 1 ] || return 0
  info=$(modo_e_dono "$f"); dono=${info%% *}; modo=${info##* }
  modo=$(printf '%03d' "$modo"); g=${modo: -2:1}; o=${modo: -1}
  if [ -z "$seg" ] && [ "$dono" != 0 ]; then
    log "ERRO: $d nao pertence ao root: $f"; exit 2
  fi
  if [ $(( g & 2 )) -ne 0 ] || [ $(( o & 2 )) -ne 0 ]; then
    log "ERRO: $d e gravavel por grupo ou outros: $f"; exit 2
  fi
  if [ -n "$seg" ] && { [ $(( g & 4 )) -ne 0 ] || [ $(( o & 4 )) -ne 0 ]; }; then
    log "ERRO: $d e legivel por grupo ou outros: $f"; exit 2
  fi
  # Sem isto a função devolve o status do último `if` -- 1 quando nenhum ramo
  # é tomado --, e o `set -e` derruba o script no primeiro arquivo correto.
  return 0
}

case "${1:-}" in --funcoes) return 0 2> /dev/null || exit 0 ;; esac

[ "${1:-}" = --config ] || { log "uso: deploy.sh --config <arquivo> <tag>"; exit 2; }
CONFIG=${2:?falta o caminho do arquivo de configuracao}
shift 2
TAG=${1:?falta a tag}
[ $# -eq 1 ] || { log "ERRO: argumentos a mais"; exit 2; }
tag_valida "$TAG" || { log "ERRO: tag recusada"; exit 2; }

confere "$CONFIG" "o arquivo de configuracao"
# shellcheck source=/dev/null
. "$CONFIG"

: "${PROJECT_DIR:?falta PROJECT_DIR na configuracao}"
: "${ENV_FILE:?falta ENV_FILE na configuracao}"
: "${COMPOSE_APP:?falta COMPOSE_APP na configuracao}"
# Projeto Compose PRÓPRIO do app: o ENV_FILE traz o COMPOSE_PROJECT_NAME do
# SUPABASE, e herdá-lo faria `up --remove-orphans` derrubar o banco.
: "${APP_PROJETO:?falta APP_PROJETO na configuracao (!= o do Supabase)}"
: "${REDE_PROXY:?falta REDE_PROXY na configuracao}"
: "${ALVO_SAUDE:?falta ALVO_SAUDE na configuracao}"
: "${MIGRA:?falta MIGRA na configuracao}"
IMAGEM=${IMAGEM:-$IMAGEM_PADRAO}
ESPERA_SMOKE=${ESPERA_SMOKE:-60}
SMOKE_IMAGEM=${SMOKE_IMAGEM:?falta SMOKE_IMAGEM na configuracao (fixe por digest)}
TRAVA=${TRAVA:-/run/complexo42-$APP_PROJETO.lock}
REGISTRO=${REGISTRO:-$PROJECT_DIR/data/logs/deploy.log}

confere "$COMPOSE_APP" "o compose do app"
confere "$MIGRA" "o aplicador de migrations"
confere "$ENV_FILE" "o arquivo de segredos" segredo
confere "$(dirname "$REGISTRO")" "o diretorio do log"
[ -L "$REGISTRO" ] && { log "ERRO: o log e um link simbolico"; exit 2; }

dc() {
  docker compose -p "$APP_PROJETO" --env-file "$ENV_FILE" -f "$COMPOSE_APP" \
    --project-directory "$PROJECT_DIR" "$@"
}
registra() { printf '%s tag=%s resultado=%s segundos=%s\n' "$(agora)" "$TAG" "$1" "$2" >> "$REGISTRO"; }

smoke() {
  local i
  for i in $(seq 1 "$ESPERA_SMOKE"); do
    if docker run --rm --network "$REDE_PROXY" "$SMOKE_IMAGEM" \
         -fsS --max-time 3 "$ALVO_SAUDE" > /dev/null 2>&1; then
      printf %s "$i"; return 0
    fi
    sleep 1
  done
  return 1
}

# Tag no ar: pelo ID do container, não por nome montado à mão -- o sufixo
# "-app-1" é convenção do Compose, não garantia.
tag_no_ar() {
  local id img
  id=$(dc ps -q app 2> /dev/null) || return 0
  [ -n "$id" ] || return 0
  img=$(docker inspect -f '{{.Config.Image}}' "$id" 2> /dev/null) || return 0
  case "$img" in *@*) return 0 ;; esac   # preso por digest: não há tag para voltar
  printf %s "${img##*:}"
}

sobe() { APP_TAG="$1" dc up -d --no-deps app; }   # sem --remove-orphans: apagaria o banco

inicio=$(date +%s)
decorrido() { echo $(( $(date +%s) - inicio )); }

exec 9> "$TRAVA" || { log "ERRO: nao consegui abrir a trava $TRAVA"; exit 4; }
command -v flock > /dev/null || { log "ERRO: flock nao esta instalado"; exit 4; }
flock -n 9 || { log "ERRO: outro deploy em andamento"; exit 3; }

ANTERIOR=$(tag_no_ar)
log "inicio tag=$TAG anterior=${ANTERIOR:-nenhuma}"

log "1/4 pull"
if ! docker pull "$IMAGEM:$TAG"; then
  log "ERRO: pull falhou"; registra pull_falhou "$(decorrido)"; exit 1
fi

# 2/4 ANTES do up: migration quebrada não pode conviver com app novo.
log "2/4 migrations"
if ! APP_TAG="$TAG" "$MIGRA"; then
  log "ERRO: migrations falharam -- app NAO foi trocado"
  registra migrations_falharam "$(decorrido)"; exit 1
fi

volta() { # volta <motivo>
  if [ -n "$ANTERIOR" ] && tag_reversivel "$ANTERIOR" && [ "$ANTERIOR" != "$TAG" ]; then
    log "rollback para $ANTERIOR"
    if sobe "$ANTERIOR" && smoke > /dev/null; then
      log "rollback saudavel"; registra "rollback_ok=$ANTERIOR" "$(decorrido)"
    else
      log "ALERTA: rollback nao responde"; registra "rollback_falhou=$ANTERIOR" "$(decorrido)"
    fi
  else
    log "ALERTA: sem tag anterior reversivel"; registra "${1}_sem_rollback" "$(decorrido)"
  fi
  exit 1
}

log "3/4 up"
if ! sobe "$TAG"; then log "ERRO: up falhou"; volta up_falhou; fi

log "4/4 smoke"
if segs=$(smoke); then
  log "saudavel em ${segs}s"; registra ok "$(decorrido)"; exit 0
fi
log "ERRO: smoke falhou"
volta smoke_falhou
