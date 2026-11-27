#!/usr/bin/env bash
# Deploy do app (issue #81, ADR 0009 §3). Versão de REFERÊNCIA: o staging roda
# esta; a produção roda a cópia do repositório de infraestrutura.
#
# RODA COMO ROOT, por sudo, a partir de um forced-command. Isso define todo o
# desenho de segurança abaixo:
#
#   - A REFERÊNCIA (tag ou digest) é o único dado que atravessa o SSH, e
#     chega por ARGUMENTO. Não se
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
# Uso: deploy.sh --config <arquivo> sha256:<digest>
#      deploy.sh --config <arquivo> emergencia:<tag>   (break-glass)
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

# ── a referência, única entrada vinda de fora ──
# CAMINHO NORMAL: só DIGEST (`sha256:<64hex>`). Tag é ponteiro; aceitar tag
# aqui esvaziaria a #161, porque o destino não imporia nada.
#
# BREAK-GLASS: `emergencia:<tag>` implanta por tag. Existe para o caso de o
# registro estar indisponível para resolver digest, ou de alguém precisar
# voltar à mão com o Actions fora do ar. Fica REGISTRADO no log como tal.
# Um token só, porque o forced-command entrega um argumento só -- separar em
# dois alargaria a interface do SSH sem necessidade.
#
# `main` não é aceita em nenhum dos dois: é móvel, e implantar um ponteiro
# móvel é exatamente o que esta issue fecha.
#
# `[[ =~ ]]` e NÃO `grep`: grep casa por LINHA, então "sha-abc1234\nrm -rf /"
# passaria pelo ^...$ olhando só a primeira linha. Medido.
tag_de_emergencia_valida() {
  [[ $1 =~ ^sha-[0-9a-f]{7,40}$ ]] && return 0
  [[ $1 =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]] && return 0
  return 1
}

referencia_valida() {
  [[ $1 =~ ^sha256:[0-9a-f]{64}$ ]] && return 0
  [[ $1 == emergencia:* ]] && tag_de_emergencia_valida "${1#emergencia:}" && return 0
  return 1
}

# O que o `docker` recebe: digest separa com `@`, tag com `:`.
imagem_de() {
  local repo=${IMAGEM:-$IMAGEM_PADRAO}
  case "$1" in
    emergencia:*) printf '%s:%s' "$repo" "${1#emergencia:}" ;;
    *)            printf '%s@%s' "$repo" "$1" ;;
  esac
}

# Imagem para a qual FAZ SENTIDO voltar: um digest DO NOSSO repositório, e
# nada mais. Regex ancorada: `repo:latest`, `outro.registro/x@sha256:...`,
# `host:5000/repo` e digest truncado são todos recusados. O destino do
# rollback é a única coisa que o script escolhe sozinho, sem ninguém revisar
# no momento -- então é onde a checagem precisa ser mais estreita, não menos.
imagem_reversivel() {
  local repo=${IMAGEM:-$IMAGEM_PADRAO}
  [[ $1 =~ ^"$repo"@sha256:[0-9a-f]{64}$ ]]
}

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

ADOTAR_INFRA=
if [ "${1:-}" = --adotar-infra ]; then ADOTAR_INFRA=1; shift; fi
[ "${1:-}" = --config ] || { log "uso: deploy.sh [--adotar-infra] --config <arquivo> <referencia>"; exit 2; }
CONFIG=${2:?falta o caminho do arquivo de configuracao}
shift 2
REFERENCIA=${1:?falta a referencia (sha256:<digest> ou emergencia:<tag>)}
[ $# -eq 1 ] || { log "ERRO: argumentos a mais"; exit 2; }
referencia_valida "$REFERENCIA" || { log "ERRO: referencia recusada"; exit 2; }
case "$REFERENCIA" in emergencia:*) MODO=emergencia ;; *) MODO=normal ;; esac

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
# Onde vivem os arquivos de infra no servidor, e o manifesto do que o deploy
# gravou neles. O manifesto fica FORA do alcance de quem nao e root.
INFRA_DIR=${INFRA_DIR:-$PROJECT_DIR}
MANIFESTO=${MANIFESTO:-$PROJECT_DIR/.infra-do-deploy}
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
# Grava a IMAGEM completa, não só a tag: com digest, o que identifica o que
# subiu é o digest. A linha fica mais longa e continua greppável.
# `modo=emergencia` fica no log: implantar por tag é exceção, e exceção que
# não deixa rastro vira regra sem ninguém decidir.
registra() { printf '%s imagem=%s modo=%s resultado=%s segundos=%s\n' "$(agora)" "$IMAGEM_ALVO" "$MODO" "$1" "$2" >> "$REGISTRO"; }

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

# Imagem no ar: pelo ID do container, não por nome montado à mão -- o sufixo
# "-app-1" é convenção do Compose, não garantia. Devolve a referência COMPLETA,
# como o Docker a guarda. Antes recortávamos a tag com `${img##*:}` e
# desistíamos quando havia `@`; agora digest é cidadão de primeira classe e o
# rollback não precisa remontar string nenhuma.
# Pelo RepoDigests, não pelo `.Config.Image`: aquele é o NOME com que o
# container subiu (pode ser uma tag, que já se moveu), este é o digest que o
# Docker realmente tem. Sem RepoDigests -- imagem só local, nunca vinda de
# registro -- devolve vazio, e o deploy segue sem rollback em vez de voltar
# para algo que não sabemos o que é.
imagem_no_ar() {
  local id
  id=$(dc ps -q app 2> /dev/null) || return 0
  [ -n "$id" ] || return 0
  docker inspect -f '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$id" 2> /dev/null || return 0
}

sobe() { APP_IMAGEM="$1" dc up -d --no-deps app; }   # sem --remove-orphans: apagaria o banco

# ── sincronia dos arquivos de infra (ADR 0015, #186) ──
# A imagem é a fonte. O manifesto guarda o que ESTE deploy gravou da última
# vez; é ele que distingue "atualização legítima" de "alguém mexeu à mão".
#
# Falha FECHADO na segunda: sobrescrever apagaria a única pista de que houve
# edição manual, e foi assim que o servidor ficou semanas com um bootstrap de
# banco que ninguém revisava (ADR 0015, Contexto).
sha_de() { sha256sum "$1" 2> /dev/null | cut -d' ' -f1; }

sincroniza_infra() {
  local tmp criado rel alvo img loc man mudou=0 initdb_mudou=0
  tmp=$(mktemp -d); criado=infra-$$
  docker create --name "$criado" "$IMAGEM_ALVO" > /dev/null
  docker cp "$criado:/app/deploy" "$tmp/deploy" 2> /dev/null || {
    docker rm -f "$criado" > /dev/null 2>&1; rm -rf "$tmp"
    log "ERRO: a imagem nao traz /app/deploy"; return 1
  }
  docker rm -f "$criado" > /dev/null 2>&1

  while IFS= read -r rel; do
    alvo="$INFRA_DIR/$rel"
    img=$(sha_de "$tmp/deploy/$rel")
    man=$(awk -v r="$rel" '$2 == r { print $1 }' "$MANIFESTO" 2> /dev/null || true)
    if [ ! -e "$alvo" ]; then
      install -D -m 644 "$tmp/deploy/$rel" "$alvo"
      log "infra: $rel NOVO (${img:0:12})"; mudou=1
    else
      loc=$(sha_de "$alvo")
      if [ "$loc" = "$img" ]; then
        continue
      elif [ -n "$man" ] && [ "$loc" = "$man" ]; then
        # era o que o deploy gravou: atualização legítima.
        cp --preserve=mode,ownership "$alvo" "$tmp/molde"
        cat "$tmp/deploy/$rel" > "$alvo"
        log "infra: $rel ${loc:0:12} -> ${img:0:12}"; mudou=1
      elif [ -n "$ADOTAR_INFRA" ]; then
        cat "$tmp/deploy/$rel" > "$alvo"
        log "infra: $rel ADOTADO ${loc:0:12} -> ${img:0:12}"; mudou=1
      else
        log "ERRO: $rel no servidor (${loc:0:12}) nao veio deste deploy nem confere"
        log "      com a imagem (${img:0:12}). Alguem editou a mao."
        log "      Resolva: leve a mudanca para o repositorio, ou rode uma vez"
        log "      com --adotar-infra para aceitar a versao da imagem."
        rm -rf "$tmp"; return 1
      fi
      case "$rel" in initdb/*) initdb_mudou=1 ;; esac
    fi
  done < <(cd "$tmp/deploy" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)

  # Manifesto novo: o estado que ESTE deploy deixou.
  : > "$MANIFESTO.novo"
  (cd "$tmp/deploy" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) | while IFS= read -r rel; do
    printf '%s  %s\n' "$(sha_de "$INFRA_DIR/$rel")" "$rel" >> "$MANIFESTO.novo"
  done
  mv "$MANIFESTO.novo" "$MANIFESTO"; chmod 600 "$MANIFESTO"

  [ "$mudou" = 0 ] && log "infra: tudo igual a imagem"
  if [ "$initdb_mudou" = 1 ]; then
    # O initdb so roda em volume VAZIO. Sincronizar o arquivo nao muda um banco
    # que ja existe -- e quem opera precisa saber disso AGORA, nao quando
    # alguem recriar o volume por outro motivo (ADR 0015, item 6).
    log "ATENCAO: o initdb/ mudou. Ele so roda em volume novo, entao o banco"
    log "         ATUAL continua com o bootstrap antigo. Recriar o volume e"
    log "         acao MANUAL -- ver docs/OPERACAO.md."
    registra initdb_mudou_recriacao_pendente "$(decorrido)"
  fi
  rm -rf "$tmp"
  return 0
}

inicio=$(date +%s)
decorrido() { echo $(( $(date +%s) - inicio )); }

exec 9> "$TRAVA" || { log "ERRO: nao consegui abrir a trava $TRAVA"; exit 4; }
command -v flock > /dev/null || { log "ERRO: flock nao esta instalado"; exit 4; }
flock -n 9 || { log "ERRO: outro deploy em andamento"; exit 3; }

IMAGEM_ALVO=$(imagem_de "$REFERENCIA")
ANTERIOR=$(imagem_no_ar)
log "inicio imagem=$IMAGEM_ALVO modo=$MODO anterior=${ANTERIOR:-nenhuma}"

log "1/5 pull"
if ! docker pull "$IMAGEM_ALVO"; then
  log "ERRO: pull falhou"; registra pull_falhou "$(decorrido)"; exit 1
fi

# A infra vem ANTES das migrations: o compose e o initdb que valem para este
# deploy sao os desta imagem, e descobrir isso depois seria tarde.
log "2/5 sincronizando infra"
if ! sincroniza_infra; then
  log "ERRO: sincronia da infra falhou -- app NAO foi trocado"
  registra infra_falhou "$(decorrido)"; exit 1
fi

# 3/5 ANTES do up: migration quebrada não pode conviver com app novo.
log "3/5 migrations"
if ! APP_IMAGEM="$IMAGEM_ALVO" "$MIGRA"; then
  log "ERRO: migrations falharam -- app NAO foi trocado"
  registra migrations_falharam "$(decorrido)"; exit 1
fi

volta() { # volta <motivo>
  if imagem_reversivel "$ANTERIOR" && [ "$ANTERIOR" != "$IMAGEM_ALVO" ]; then
    log "rollback para $ANTERIOR"
    if sobe "$ANTERIOR" && smoke > /dev/null; then
      log "rollback saudavel"; registra "rollback_ok=$ANTERIOR" "$(decorrido)"
    else
      log "ALERTA: rollback nao responde"; registra "rollback_falhou=$ANTERIOR" "$(decorrido)"
    fi
  else
    log "ALERTA: sem imagem anterior reversivel"; registra "${1}_sem_rollback" "$(decorrido)"
  fi
  exit 1
}

log "4/5 up"
if ! sobe "$IMAGEM_ALVO"; then log "ERRO: up falhou"; volta up_falhou; fi

log "5/5 smoke"
if segs=$(smoke); then
  log "saudavel em ${segs}s"; registra ok "$(decorrido)"; exit 0
fi
log "ERRO: smoke falhou"
volta smoke_falhou
