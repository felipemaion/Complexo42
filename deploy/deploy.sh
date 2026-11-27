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

# Devolve 1, NAO sai. Assim a mesma conferencia serve para duas coisas: a de
# partida, que aborta com `|| exit 2`, e a da sincronia, que precisa falhar pelo
# caminho normal -- com `registra infra_falhou` no log -- e nao com exit seco.
confere() { # confere <caminho> <descricao> [segredo]
  local f=$1 d=$2 seg=${3:-} info dono modo g o
  [ -e "$f" ] || { log "ERRO: $d nao existe: $f"; return 1; }
  [ -L "$f" ] && { log "ERRO: $d e um link simbolico: $f"; return 1; }
  [ "$SOU_ROOT" = 1 ] || return 0
  info=$(modo_e_dono "$f"); dono=${info%% *}; modo=${info##* }
  modo=$(printf '%03d' "$modo"); g=${modo: -2:1}; o=${modo: -1}
  if [ -z "$seg" ] && [ "$dono" != 0 ]; then
    log "ERRO: $d nao pertence ao root: $f"; return 1
  fi
  if [ $(( g & 2 )) -ne 0 ] || [ $(( o & 2 )) -ne 0 ]; then
    log "ERRO: $d e gravavel por grupo ou outros: $f"; return 1
  fi
  if [ -n "$seg" ] && { [ $(( g & 4 )) -ne 0 ] || [ $(( o & 4 )) -ne 0 ]; }; then
    log "ERRO: $d e legivel por grupo ou outros: $f"; return 1
  fi
  # Sem isto a função devolve o status do último `if` -- 1 quando nenhum ramo
  # é tomado --, e o `set -e` derruba o script no primeiro arquivo correto.
  return 0
}

# ── primitivas da sincronia de infra (ADR 0015, #186) ──
#
# A LISTA do que o deploy aceita gravar como root esta AQUI, no script, e NAO
# vem da imagem. Esse e o ponto: a imagem e a fonte do CONTEUDO, nunca a fonte
# da LISTA. Se quem decide os caminhos for o que a imagem traz, um build
# comprometido -- ou so um arquivo novo em `deploy/` que o `.dockerignore` nao
# exclua -- faz o root gravar o que quiser dentro do diretorio de deploy.
#
# O caso concreto que isto fecha: a imagem passaria a trazer `migra.sh`, o root
# gravaria por cima do aplicador de migrations, e o passo 3/5 o EXECUTA. Era
# root no host a partir de um push.
#
# Acrescentar arquivo aqui e decisao revisada em PR, que e onde ela tem de ser.
INFRA_PERMITIDA=(
  docker-compose.supabase.yml
  kong.yml
  initdb/01-extensions.sql
  initdb/02-roles.sh
)

permitida() {
  local p
  for p in "${INFRA_PERMITIDA[@]}"; do [ "$1" = "$p" ] && return 0; done
  return 1
}

# Nome que a imagem pode trazer. O que o deploy GRAVA vem da lista fixa, mas
# para dizer "a imagem traz algo a mais" ainda e preciso ler nome vindo de
# fora -- e nome e dado hostil como qualquer outro.
nome_seguro() {
  [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || return 1
  [[ $1 != *..* ]] || return 1
  return 0
}

# Nenhum componente do caminho pode ser link simbolico -- nem o alvo, nem
# diretorio nenhum ate ele. Sem isto, trocar `initdb` por um link faz o root
# escrever fora do diretorio de deploy: `cat > alvo` segue link de bom grado, e
# `install -D` cria o que falta no caminho para onde o link aponta.
sem_links() { # sem_links <relativo>
  local d=$INFRA_DIR parte
  [ -L "$d" ] && { log "ERRO: o diretorio de infra e um link simbolico: $d"; return 1; }
  local IFS=/
  for parte in $1; do
    d="$d/$parte"
    [ -L "$d" ] && { log "ERRO: caminho de infra passa por link simbolico: $d"; return 1; }
  done
  return 0
}

sha_de() { sha256sum "$1" 2> /dev/null | cut -d' ' -f1; }

# Gravacao ATOMICA e conferida: temporario no MESMO diretorio (para o `mv` ser
# rename, e nao copia que pode parar no meio), sha256 conferido depois de
# escrever, e so entao o rename.
#
# Cada passo com `|| return 1` EXPLICITO: esta funcao roda dentro de um `if !`,
# e ali o `set -e` nao vale -- medido, o corpo segue depois do comando que
# falhou e a funcao ainda devolve 0. Sem o `||`, uma gravacao que falha seguiria
# em frente e o manifesto registraria o que nao foi escrito.
# INFRA_DIR e cada diretorio intermediario tem de ser do root e nao gravavel
# por grupo/outros. Sem isto, `initdb/` com modo 777 ou de outro dono permite
# trocar o temporario ENTRE o sha256 e o `mv`, e o que fica no lugar e um
# `02-roles.sh` de quem quiser -- que roda como superusuario do banco na
# proxima recriacao do volume.
#
# E e tambem o que torna o `mv` seguro sem o `-T` do GNU (que o macOS nao tem, e
# o teste roda la): com os pais conferidos, ninguem pode por um diretorio no
# lugar do alvo entre a conferencia e o rename.
confere_pais() { # confere_pais <relativo>
  local d=$INFRA_DIR resto=$1 parte
  confere "$d" "o diretorio de infra" || return 1
  while [ "$resto" != "${resto#*/}" ]; do
    parte=${resto%%/*}; resto=${resto#*/}
    d="$d/$parte"
    confere "$d" "o diretorio $parte/ da infra" || return 1
  done
  return 0
}

grava_infra() { # grava_infra <origem> <alvo absoluto> <relativo>
  local origem=$1 alvo=$2 rel=$3 dir tmp modo=644 info
  sem_links "$rel" || return 1
  dir=${alvo%/*}
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir" || { log "ERRO: nao consegui criar $dir"; return 1; }
    chmod 755 "$dir" || return 1
  fi
  confere_pais "$rel" || return 1
  if [ -e "$alvo" ] && { [ ! -f "$alvo" ] || [ -L "$alvo" ]; }; then
    log "ERRO: $rel no servidor nao e arquivo comum"; return 1
  fi
  # Preserva o modo do que ja esta la: se o operador fechou um arquivo para
  # 600, atualizar nao e motivo para o deploy afrouxar de volta para 644.
  if [ -f "$alvo" ]; then info=$(modo_e_dono "$alvo") && modo=${info##* }; fi
  tmp=$(mktemp "$dir/.infra.XXXXXX") || { log "ERRO: nao consegui criar temporario em $dir"; return 1; }
  cat "$origem" > "$tmp" || { rm -f "$tmp"; log "ERRO: falhei ao escrever $rel"; return 1; }
  if [ "$(sha_de "$tmp")" != "$(sha_de "$origem")" ]; then
    rm -f "$tmp"; log "ERRO: $rel saiu diferente da origem depois de escrito"; return 1
  fi
  chmod "$modo" "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f -- "$tmp" "$alvo" || { rm -f "$tmp"; log "ERRO: falhei ao por $rel no lugar"; return 1; }
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

confere "$CONFIG" "o arquivo de configuracao" || exit 2
# Limpos ANTES de carregar a configuracao. Depois do `.` nao da mais para
# distinguir "veio da config" de "veio do ambiente", e `${X:-padrao}` aceitaria
# o ambiente calado -- contra o que diz o cabecalho deste script. Com o
# env_reset do sudo o ambiente nem chega aqui; o `unset` e o que garante que
# continue assim se alguem afrouxar o sudoers.
unset PROJECT_DIR ENV_FILE COMPOSE_APP APP_PROJETO REDE_PROXY ALVO_SAUDE MIGRA
unset INFRA_DIR MANIFESTO IMAGEM ESPERA_SMOKE SMOKE_IMAGEM TRAVA REGISTRO
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
# gravou neles.
#
# O manifesto NAO mora no diretorio de deploy. Modo 600 protege o CONTEUDO do
# arquivo, nao o NOME: quem pode escrever no diretorio apaga o manifesto e poe
# outro no lugar. E manifesto forjado inverte a garantia da ADR 0015 -- faz a
# divergencia "conferir" e o deploy sobrescrever justamente o arquivo que
# alguem editou a mao. Por isso o padrao e um diretorio so do root.
INFRA_DIR=${INFRA_DIR:-$PROJECT_DIR}
MANIFESTO=${MANIFESTO:-/etc/complexo42/infra-$APP_PROJETO.manifesto}
IMAGEM=${IMAGEM:-$IMAGEM_PADRAO}
ESPERA_SMOKE=${ESPERA_SMOKE:-60}
SMOKE_IMAGEM=${SMOKE_IMAGEM:?falta SMOKE_IMAGEM na configuracao (fixe por digest)}
TRAVA=${TRAVA:-/run/complexo42-$APP_PROJETO.lock}
REGISTRO=${REGISTRO:-$PROJECT_DIR/data/logs/deploy.log}

confere "$COMPOSE_APP" "o compose do app" || exit 2
confere "$MIGRA" "o aplicador de migrations" || exit 2
confere "$ENV_FILE" "o arquivo de segredos" segredo || exit 2
confere "$(dirname "$REGISTRO")" "o diretorio do log" || exit 2
[ -L "$REGISTRO" ] && { log "ERRO: o log e um link simbolico"; exit 2; }
# O diretorio de infra e o do manifesto entram na MESMA conferencia do resto: o
# deploy grava neles como root, e diretorio gravavel por outros e o problema de
# sempre -- quem escreve ali troca o arquivo entre a conferencia e o uso.
confere "$INFRA_DIR" "o diretorio de infra" || exit 2
confere "$(dirname "$MANIFESTO")" "o diretorio do manifesto de infra" || exit 2
if [ -e "$MANIFESTO" ]; then confere "$MANIFESTO" "o manifesto de infra" || exit 2; fi

# Tripwire: nenhum arquivo da lista de infra pode coincidir com um arquivo que
# o proprio deploy le ou EXECUTA. Hoje nao coincide; a conferencia existe para
# que acrescentar uma entrada descuidada na lista derrube o deploy em vez de
# entregar o host. Comparacao textual, sobre os caminhos absolutos da config.
for _rel in "${INFRA_PERMITIDA[@]}"; do
  for _proibido in "$ENV_FILE" "$COMPOSE_APP" "$MIGRA" "$REGISTRO" "$MANIFESTO" "$CONFIG"; do
    [ "$INFRA_DIR/$_rel" = "$_proibido" ] && {
      log "ERRO: a lista de infra inclui um arquivo que o deploy le ou executa: $_rel"
      exit 2
    }
  done
done
unset _rel _proibido

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
# A imagem e a fonte do CONTEUDO. O manifesto guarda o que ESTE deploy gravou
# da ultima vez; e ele que distingue "atualizacao legitima" de "alguem mexeu a
# mao".
#
# Falha FECHADO na segunda: sobrescrever apagaria a unica pista de que houve
# edicao manual, e foi assim que o servidor ficou semanas com um bootstrap de
# banco que ninguem revisava (ADR 0015, Contexto).

# Estado da sincronia em curso, para a limpeza poder acontecer de qualquer
# lugar -- inclusive de um sinal no meio do `docker cp`.
INFRA_TMP=
INFRA_CONTAINER=
limpa_infra() {
  [ -n "$INFRA_CONTAINER" ] && docker rm -f "$INFRA_CONTAINER" > /dev/null 2>&1
  [ -n "$INFRA_TMP" ] && rm -rf "$INFRA_TMP"
  INFRA_TMP=; INFRA_CONTAINER=
  return 0
}

# Limpeza garantida nos DOIS caminhos. Sem isso, imagem sem /app/deploy deixava
# um container parado para tras a cada tentativa. O nome leva $RANDOM porque $$
# se repete entre deploys de projetos diferentes.
extrai_infra() { # extrai_infra <raiz temporaria>
  local rc=0
  INFRA_CONTAINER=infra-$$-$RANDOM
  docker create --name "$INFRA_CONTAINER" "$IMAGEM_ALVO" > /dev/null 2>&1 || {
    INFRA_CONTAINER=; log "ERRO: nao consegui criar container para extrair a infra"; return 1
  }
  docker cp "$INFRA_CONTAINER:/app/deploy" "$1/deploy" > /dev/null 2>&1 || {
    log "ERRO: a imagem nao traz /app/deploy"; rc=1
  }
  docker rm -f "$INFRA_CONTAINER" > /dev/null 2>&1 || log "ALERTA: o container $INFRA_CONTAINER ficou para tras"
  INFRA_CONTAINER=
  return $rc
}

# A imagem tem de trazer EXATAMENTE a lista: nada a mais. Arquivo sobrando e
# sinal de que `deploy/` cresceu sem ninguem olhar o `.dockerignore` -- que e
# uma lista de EXCLUSAO, entao arquivo novo entra na imagem por omissao. E e
# assim que um `*.key` ou um `staging.env` viajaria junto.
confere_sobras() { # confere_sobras <raiz temporaria>
  local dir=$1/deploy lista=$1/lista rel sobra=0
  # /app/deploy como LINK na imagem: o `docker cp` o materializa como link, e
  # dai todo o caminho abaixo dele sai do nosso controle.
  [ -L "$dir" ] && { log "ERRO: /app/deploy na imagem e um link simbolico"; return 1; }
  [ -d "$dir" ] || { log "ERRO: /app/deploy nao chegou como diretorio"; return 1; }
  # Lista PRIMEIRO, com o erro detectado. Antes isto ia direto para o `while`
  # por substituicao de processo, onde `cd` ou `find` falhando viram "nenhuma
  # sobra": a conferencia passava justamente quando nao havia o que conferir.
  (cd "$dir" && find . ! -type d -print0) > "$lista" || {
    log "ERRO: nao consegui listar /app/deploy da imagem"; return 1
  }
  while IFS= read -r -d '' rel; do
    rel=${rel#./}
    # O nome recusado NAO e impresso: nome vindo de fora pode levar sequencia
    # de escape, e o log do deploy e lido em terminal.
    if ! nome_seguro "$rel"; then
      log "ERRO: a imagem traz nome de arquivo recusado em /app/deploy"; sobra=1; continue
    fi
    if ! permitida "$rel"; then
      log "ERRO: a imagem traz arquivo fora da lista de infra: $rel"; sobra=1; continue
    fi
    if [ -L "$dir/$rel" ]; then
      # Link na imagem com nome permitido: `cat` leria o destino NO HOST e o
      # deploy gravaria esse conteudo no servidor. /etc/shadow como kong.yml.
      log "ERRO: $rel na imagem e um link simbolico"; sobra=1
    fi
  done < "$lista"
  rm -f "$lista"
  [ "$sobra" = 0 ] || return 1
  return 0
}

# O manifesto e o estado que ESTE deploy deixou NO DISCO. Escrito por inteiro e
# trocado por rename: manifesto meio escrito faria o deploy SEGUINTE ver
# divergencia onde nao houve, e falhar fechado sem motivo.
grava_manifesto() {
  local dir=${MANIFESTO%/*} tmp rel sha
  [ -d "$dir" ] || { log "ERRO: o diretorio do manifesto nao existe: $dir"; return 1; }
  tmp=$(mktemp "$dir/.manifesto.XXXXXX") || { log "ERRO: nao consegui criar temporario do manifesto"; return 1; }
  for rel in "${INFRA_PERMITIDA[@]}"; do
    # Arquivo que ainda nao esta no disco nao entra. O manifesto diz o que o
    # deploy DEIXOU, e na primeira execucao ele grava um de cada vez: exigir os
    # quatro aqui faria a primeira gravacao falhar por causa das tres que ainda
    # nao aconteceram. Linha ausente e lida como "nao foi o deploy que gravou",
    # que e exatamente o certo para arquivo que o deploy nunca tocou.
    [ -f "$INFRA_DIR/$rel" ] || continue
    # O sha vai para uma variavel e e conferido: dentro do `printf` um sha
    # vazio viraria uma linha sem hash, que o deploy seguinte leria como
    # "nao foi o deploy que gravou" e travaria.
    sha=$(sha_de "$INFRA_DIR/$rel")
    if [ -z "$sha" ]; then
      rm -f "$tmp"; log "ERRO: nao consegui calcular o sha256 de $rel para o manifesto"; return 1
    fi
    printf '%s  %s\n' "$sha" "$rel" >> "$tmp" || {
      rm -f "$tmp"; log "ERRO: falhei ao escrever o manifesto"; return 1
    }
  done
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f -- "$tmp" "$MANIFESTO" || { rm -f "$tmp"; log "ERRO: falhei ao por o manifesto no lugar"; return 1; }
  return 0
}

# Gravar e registrar andam JUNTOS. O manifesto e refeito depois de cada
# gravacao, nao uma vez no fim: assim ele diz sempre o que esta no disco.
# Antes, falha na terceira gravacao deixava as duas primeiras sem registro, e o
# deploy SEGUINTE as lia como edicao a mao e travava -- precisando de
# `--adotar-infra` por um erro que nao foi de ninguem. Sao quatro linhas de
# sha256: refazer a cada arquivo nao custa nada.
grava_e_registra() { # grava_e_registra <origem> <alvo> <relativo>
  grava_infra "$1" "$2" "$3" || return 1
  grava_manifesto || return 1
  return 0
}

# Um ponto so de limpeza, e trap para o sinal no meio do caminho.
sincroniza_infra() {
  local rc
  INFRA_TMP=$(mktemp -d) || { log "ERRO: nao consegui criar diretorio temporario"; return 1; }
  # So INT/TERM, nunca EXIT: trap de EXIT faz as checagens `${VAR:?}` deste
  # script sairem com 0 -- medido, e esta no SERVER.md como gotcha 63.
  trap 'limpa_infra; exit 130' INT TERM
  sincroniza_infra_em "$INFRA_TMP"; rc=$?
  trap - INT TERM
  limpa_infra
  return $rc
}

sincroniza_infra_em() {
  local tmp=$1 rel alvo origem img loc man mudou=0 initdb_mudou=0 i=0
  local -a acao=() sha_img=()
  extrai_infra "$tmp" || return 1
  confere_sobras "$tmp" || return 1

  # ── passada 1: DECIDE tudo antes de gravar qualquer coisa ──
  # Tudo ou nada. Antes, um arquivo que divergia DEPOIS de outro ja ter sido
  # gravado derrubava o deploy com o disco pela metade -- e, pior, o manifesto
  # desatualizado fazia o deploy SEGUINTE travar como se alguem tivesse editado
  # a mao. Decidir primeiro faz a recusa acontecer com o disco intocado.
  for rel in "${INFRA_PERMITIDA[@]}"; do
    origem="$tmp/deploy/$rel"; alvo="$INFRA_DIR/$rel"
    if [ ! -f "$origem" ] || [ -L "$origem" ]; then
      log "ERRO: a imagem nao traz $rel"; return 1
    fi
    img=$(sha_de "$origem")
    [ -n "$img" ] || { log "ERRO: nao consegui calcular o sha256 de $rel na imagem"; return 1; }
    sha_img[i]=$img
    man=$(awk -v r="$rel" '$2 == r { print $1 }' "$MANIFESTO" 2> /dev/null || true)
    if [ ! -e "$alvo" ]; then
      acao[i]=novo
    elif [ ! -f "$alvo" ] || [ -L "$alvo" ]; then
      # ANTES de qualquer sha256: um fifo no lugar do alvo travaria o
      # `sha256sum` para sempre, com a trava do deploy presa com ele.
      log "ERRO: $rel no servidor nao e arquivo comum"; return 1
    else
      loc=$(sha_de "$alvo")
      [ -n "$loc" ] || { log "ERRO: nao consegui calcular o sha256 de $rel no servidor"; return 1; }
      if [ "$loc" = "$img" ]; then
        acao[i]=igual
      elif [ -n "$man" ] && [ "$loc" = "$man" ]; then
        acao[i]=atualiza:$loc          # era o que o deploy gravou: legitimo
      elif [ -n "$ADOTAR_INFRA" ]; then
        acao[i]=adota:$loc
      else
        log "ERRO: $rel no servidor (${loc:0:12}) nao veio deste deploy nem confere"
        log "      com a imagem (${img:0:12}). Alguem editou a mao."
        log "      Resolva: leve a mudanca para o repositorio, ou rode uma vez"
        log "      com --adotar-infra para aceitar a versao da imagem."
        return 1
      fi
    fi
    i=$((i + 1))
  done

  # ── passada 2: grava, registrando no manifesto a cada arquivo ──
  i=0
  for rel in "${INFRA_PERMITIDA[@]}"; do
    origem="$tmp/deploy/$rel"; alvo="$INFRA_DIR/$rel"; img=${sha_img[i]}
    case ${acao[i]} in
      igual) ;;
      novo)
        grava_e_registra "$origem" "$alvo" "$rel" || return 1
        log "infra: $rel NOVO (${img:0:12})"; mudou=1 ;;
      atualiza:*)
        loc=${acao[i]#atualiza:}
        grava_e_registra "$origem" "$alvo" "$rel" || return 1
        log "infra: $rel ${loc:0:12} -> ${img:0:12}"; mudou=1 ;;
      adota:*)
        loc=${acao[i]#adota:}
        grava_e_registra "$origem" "$alvo" "$rel" || return 1
        log "infra: $rel ADOTADO ${loc:0:12} -> ${img:0:12}"; mudou=1 ;;
    esac
    # FORA do ramo do arquivo que ja existia: antes este `case` so rodava la,
    # entao arquivo NOVO em initdb/ nao disparava o aviso -- e e o caso em que
    # ele mais importa, porque e initdb que nunca rodou.
    case ${acao[i]} in igual) ;; *) case "$rel" in initdb/*) initdb_mudou=1 ;; esac ;; esac
    i=$((i + 1))
  done

  # Tambem quando nada mudou: na primeira execucao o manifesto nao existe, e
  # sem esta chamada o deploy seguinte leria tudo como edicao a mao.
  grava_manifesto || return 1

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
# No break-glass a imagem vem por TAG, que e ponteiro movel. Gravar arquivos de
# infra como root a partir de um ponteiro movel e o oposto do que o break-glass
# quer: ele existe para restabelecer servico, nao para reescrever infra. A infra
# fica como esta, e a proxima implantacao normal a sincroniza.
if [ "$MODO" = emergencia ]; then
  log "infra: PULADA no modo emergencia (imagem por tag); infra fica como esta"
elif ! sincroniza_infra; then
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
