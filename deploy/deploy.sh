#!/usr/bin/env bash
# Deploy do app (issue #81, ADR 0009 §3). Versão de REFERÊNCIA: o staging roda
# esta; a produção roda a cópia do repositório de infraestrutura.
#
# Disparado pelo Actions por SSH com forced-command. A TAG é o ÚNICO dado que
# atravessa o SSH, e por isso é a única superfície de ataque deste script:
# qualquer coisa que não case com o formato esperado é recusada antes de
# chegar perto de um `docker`.
#
# Quatro etapas (ADR 0009 §3), nesta ordem, que é a proteção:
#   1. pull da tag  2. migrations (ABORTA aqui se falhar, app intacto)
#   3. up do app    4. smoke em /api/healthz; se falhar, volta para a anterior
#
# Caminhos e nomes vêm do ambiente: este repositório é público e não carrega
# endereço, usuário nem caminho de servidor.
set -euo pipefail
umask 077

IMAGEM=${IMAGEM:-ghcr.io/felipemaion/complexo42}
ESPERA_SMOKE=${ESPERA_SMOKE:-60}
SMOKE_IMAGEM=${SMOKE_IMAGEM:-curlimages/curl:8.11.1}
CAMINHO_SAUDE=${CAMINHO_SAUDE:-/api/healthz}

agora() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s %s\n' "$(agora)" "$*"; }

# ── a tag, única entrada vinda de fora ──
# Aceita só o que o build.yml produz. Sem isto, `sha-abc; docker rm -f db`
# chegaria a um shell: o forced-command restringe o COMANDO, não o argumento.
tag_valida() {
  case "$1" in
    sha-*) printf %s "$1" | grep -Eq '^sha-[0-9a-f]{7,40}$' ;;
    v*)    printf %s "$1" | grep -Eq '^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$' ;;
    main)  true ;;
    *)     false ;;
  esac
}

case "${1:-}" in --funcoes) return 0 2> /dev/null || exit 0 ;; esac

: "${PROJECT_DIR:?falta PROJECT_DIR (diretório de deploy do ambiente)}"
: "${ENV_FILE:?falta ENV_FILE (arquivo de segredos do ambiente)}"
: "${COMPOSE_APP:?falta COMPOSE_APP (compose do app)}"
# Projeto Compose PRÓPRIO do app. O ENV_FILE traz o COMPOSE_PROJECT_NAME do
# SUPABASE; herdá-lo faria o app e o banco dividirem projeto, e um
# `up --remove-orphans` derrubaria o banco. Por isso `-p` explícito sempre.
: "${APP_PROJETO:?falta APP_PROJETO (projeto Compose do app, != o do Supabase)}"

TAG=${1:-${SSH_ORIGINAL_COMMAND:-}}
TAG=${TAG##* }
tag_valida "$TAG" || { log "ERRO: tag recusada"; exit 2; }

TRAVA=${TRAVA:-$PROJECT_DIR/.deploy.lock}
REGISTRO=${REGISTRO:-$PROJECT_DIR/data/logs/deploy.log}
mkdir -p "$(dirname "$REGISTRO")"

dc() {
  docker compose -p "$APP_PROJETO" --env-file "$ENV_FILE" -f "$COMPOSE_APP" \
    --project-directory "$PROJECT_DIR" "$@"
}

registra() {
  printf '%s tag=%s resultado=%s segundos=%s\n' "$(agora)" "$TAG" "$1" "$2" >> "$REGISTRO"
}

smoke() {
  local alvo=$1 i
  for i in $(seq 1 "$ESPERA_SMOKE"); do
    if docker run --rm --network "$REDE_PROXY" "$SMOKE_IMAGEM" \
         -fsS --max-time 3 "$alvo" > /dev/null 2>&1; then
      printf %s "$i"; return 0
    fi
    sleep 1
  done
  return 1
}

deploy() {
  local inicio anterior
  inicio=$(date +%s)

  # A tag anterior sai do container que está NO AR, não de um arquivo de
  # estado: arquivo mente quando alguém mexe à mão, container não.
  anterior=$(docker inspect -f '{{.Config.Image}}' "$APP_PROJETO-app-1" 2> /dev/null || true)
  anterior=${anterior##*:}
  log "inicio tag=$TAG anterior=${anterior:-nenhuma}"

  log "1/4 pull"
  docker pull "$IMAGEM:$TAG"

  # 2/4 ANTES do up, de propósito: migration que falha não pode conviver com
  # app novo. Falhar aqui deixa tudo como estava.
  log "2/4 migrations"
  if ! APP_TAG="$TAG" "$MIGRA" ; then
    log "ERRO: migrations falharam -- app NAO foi trocado"
    registra "migrations_falharam" "$(($(date +%s) - inicio))"
    return 1
  fi

  log "3/4 up"
  # Sem --remove-orphans: ele apaga o que nao esta neste compose, e o banco
  # do ambiente nao esta.
  APP_TAG="$TAG" dc up -d --no-deps app

  log "4/4 smoke em $CAMINHO_SAUDE"
  local segs
  if segs=$(smoke "$ALVO_SAUDE"); then
    log "saudavel em ${segs}s"
    registra "ok" "$(($(date +%s) - inicio))"
    return 0
  fi

  log "ERRO: smoke falhou"
  if [ -n "$anterior" ] && [ "$anterior" != "$TAG" ]; then
    log "rollback para $anterior"
    APP_TAG="$anterior" dc up -d --no-deps app
    if smoke "$ALVO_SAUDE" > /dev/null; then
      log "rollback saudavel"
      registra "rollback_ok=$anterior" "$(($(date +%s) - inicio))"
    else
      log "ALERTA: rollback tambem nao responde"
      registra "rollback_falhou=$anterior" "$(($(date +%s) - inicio))"
    fi
  else
    log "ALERTA: sem tag anterior para voltar"
    registra "smoke_falhou_sem_rollback" "$(($(date +%s) - inicio))"
  fi
  return 1
}

: "${REDE_PROXY:?falta REDE_PROXY (rede externa do proxy reverso)}"
: "${ALVO_SAUDE:?falta ALVO_SAUDE (ex.: http://<alias-do-app>:3000$CAMINHO_SAUDE)}"
MIGRA=${MIGRA:-$PROJECT_DIR/migra.sh}

# Um deploy por vez. Sem isto, dois merges seguidos na main trocam a imagem
# ao mesmo tempo e o rollback de um desfaz o outro.
exec 9> "$TRAVA"
flock -n 9 || { log "ERRO: outro deploy em andamento"; exit 3; }

deploy
