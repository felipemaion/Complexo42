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
unset DB_CONTAINER DB_USER DB_NOME
unset INFRA_DIR MANIFESTO IMAGEM ESPERA_SMOKE SMOKE_IMAGEM TRAVA REGISTRO
unset SUPABASE_PROJETO
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
# OPCIONAL, e de proposito. Sem ela o deploy NAO recria nada no Supabase: só
# avisa, alto, que a mudanca ficou no disco sem valer. Adivinhar o nome do
# projeto seria pior que nao agir -- um `up -d` no projeto errado, com o
# compose do Supabase, derruba o banco. Sem configuracao, comportamento de
# antes; com ela, recriacao seletiva.
SUPABASE_PROJETO=${SUPABASE_PROJETO:-}
# O que o migra.sh precisa. Exigido AQUI, com o resto da configuracao, e nao la
# dentro: la ele so e exigido na etapa 3/5, DEPOIS do pull e da sincronia da
# infra -- o deploy faz trabalho, muda arquivos no servidor e so entao descobre
# que falta uma linha de configuracao. Falhar na partida custa nada.
: "${DB_CONTAINER:?falta DB_CONTAINER na configuracao (container do banco do ambiente)}"
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

# ── aplicar a infra: gravar o arquivo nao e trocar o que roda ────────────
# Quatro vezes em 2026-11-27 a sincronia gravou e o container seguiu com o
# conteudo antigo: DB_CONTAINER, os templates em portugues, o kong.yml do #247
# e o migra.sh. Nas quatro o deploy ficou VERDE. Isto fecha os dois casos que
# sao do compose do Supabase.
dc_supabase() {
  # --project-directory explicito: e o padrao (o diretorio do arquivo), mas
  # deixar implicito faria caminho relativo dentro do compose depender de onde
  # o deploy foi chamado.
  docker compose -p "$SUPABASE_PROJETO" --env-file "$ENV_FILE" \
    --project-directory "$INFRA_DIR" \
    -f "$INFRA_DIR/docker-compose.supabase.yml" "$@"
}

# Ecoa a saida do compose no log, LIMITADA. Erro de interpolacao do compose
# cita o NOME da variavel, nao o valor -- mas saida de terceiro no log do root
# merece teto, e `head` aqui nao esconde decisao nenhuma: a decisao sai das
# funcoes abaixo, nao do que foi impresso. Serve ao ensaio e ao preflight.
ecoa_compose() { # ecoa_compose <texto> [prefixo]
  local texto=$1 pre=${2:-ensaio} l n=0
  while IFS= read -r l; do
    n=$((n + 1))
    [ "$n" -gt 20 ] && { log "  $pre: (... saida truncada em 20 linhas)"; return 0; }
    log "  $pre: $l"
  done <<< "$texto"
  return 0
}

# Saida do compose que passou pelo --env-file: ECOAR A LINHA NAO SERVE, nem
# filtrada. Apontado em revisao: erro de dotenv tem a forma
#   unexpected character "x" in variable name near "CHAVE=valor-secreto"
# e um filtro por linha casa "variable" e leva o VALOR para o log do root.
# Aqui nao se filtra linha: EXTRAI-SE o nome da variavel, e so ele e impresso.
# Lista de permissao, como a guarda do CI -- o que nao casa padrao conhecido
# nao aparece, nem truncado.
#
# Um grep so, com o resultado capturado e a falha tratada: pipeline de greps
# aqui morria com `pipefail` quando um deles nao casava, e o `set -e` derrubava
# a funcao -- o deploy saia ANTES do `registra`. Mesma familia da armadilha 63
# do SERVER.md, e foi um teste que pegou.
nomes_de_variavel() { # nomes_de_variavel <texto>
  local texto=$1 bruto=""
  bruto=$(printf '%s' "$texto" | grep -oE \
    'required variable [A-Za-z_][A-Za-z0-9_]*|"[A-Za-z_][A-Za-z0-9_]*" variable is not set|variable [A-Za-z_][A-Za-z0-9_]* is (missing|required)' \
    2> /dev/null) || bruto=""
  [ -z "$bruto" ] && return 0
  printf '%s\n' "$bruto" | sed -E \
    -e 's/^required variable //' \
    -e 's/^"([^"]*)".*/\1/' \
    -e 's/^variable ([A-Za-z_][A-Za-z0-9_]*) .*/\1/' | sort -u
  return 0
}

ecoa_variaveis() { # ecoa_variaveis <texto> <prefixo>
  local texto=$1 pre=$2 nomes="" v total=0
  nomes=$(nomes_de_variavel "$texto") || nomes=""
  total=$(printf '%s\n' "$texto" | grep -c . 2> /dev/null) || total=0
  if [ -z "$nomes" ]; then
    log "  $pre: nenhum nome de variavel reconhecido na saida do compose"
    log "  $pre: ($total linhas omitidas de proposito -- podem conter valor do env)"
    return 0
  fi
  while IFS= read -r v; do
    [ -n "$v" ] && log "  $pre: variavel sem valor: $v"
  done <<< "$nomes"
  log "  $pre: ($total linhas da saida omitidas de proposito -- so os nomes acima)"
  return 0
}

# PROVA POSITIVA de que o projeto configurado e o que roda ESTE ambiente.
# Lista negativa nao serve, e isto foi apontado em revisao: com
# SUPABASE_PROJETO errado (typo, ou projeto de outro ambiente) o ensaio fala
# de containers com OUTRO nome, nada casa com DB_CONTAINER, a trava passa --
# e o `up -d` sobe uma SEGUNDA pilha a partir do mesmo compose: banco novo,
# volume novo, initdb rodando. Fecha-se exigindo que o banco conhecido deste
# ambiente seja, ele mesmo, do projeto em que vamos agir.
confere_projeto_do_supabase() {
  local dono
  dono=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' \
    "$DB_CONTAINER" 2> /dev/null) || dono=
  if [ -z "$dono" ]; then
    log "ERRO: nao consegui ler o projeto Compose do banco ($DB_CONTAINER)."
    log "      Sem essa prova eu NAO mexo no Supabase -- agir no projeto errado"
    log "      subiria uma segunda pilha, com banco e volume novos."
    return 1
  fi
  if [ "$dono" != "$SUPABASE_PROJETO" ]; then
    log "ERRO: SUPABASE_PROJETO=$SUPABASE_PROJETO, mas o banco deste ambiente"
    log "      ($DB_CONTAINER) pertence ao projeto $dono. Configuracao errada."
    return 1
  fi
  return 0
}

# Le o ensaio e decide se o banco esta em risco. Sem `|`: com pipefail, um
# `printf | grep -q` pode morrer de SIGPIPE e a trava falharia ABERTO -- a
# mesma familia de erro da armadilha 61 (a conferencia que passa justamente
# quando nao devia).
banco_em_risco() { # banco_em_risco <texto do ensaio>
  local linhas
  # -F: nome de container nao e expressao regular.
  linhas=$(grep -F -- "$DB_CONTAINER" <<< "$1") || linhas=
  if [ -z "$linhas" ]; then
    log "ERRO: o ensaio nao menciona o banco ($DB_CONTAINER) de forma nenhuma."
    log "      Isso nao e silencio tranquilizador: ou o compose nao tem mais o"
    log "      servico do banco, ou estamos olhando outro projeto."
    return 0
  fi
  # Create/Recreate/Remove/Stop/Kill/Restart tocam o banco. Running, Start* e
  # Skipped nao: banco parado que sobe de novo nao perde nada.
  if grep -Eq '(Creat|Recreat|Remov|Stopp?|Kill|Restart)' <<< "$linhas"; then
    log "ERRO: o ensaio diz que o banco ($DB_CONTAINER) seria tocado:"
    ecoa_compose "$linhas"
    return 0
  fi
  return 1
}

# Devolve o conteudo anterior dos arquivos que esta sincronia trocou e refaz o
# manifesto. Refazer o manifesto NAO e detalhe: sem isso o disco passa a
# divergir do que o manifesto diz, e o deploy SEGUINTE trava como se alguem
# tivesse editado a mao -- a armadilha que custou 40 minutos em 2026-11-27.
restaura_infra() { # restaura_infra <raiz temporaria>
  local tmp=$1 rel falhou=0
  for rel in "${INFRA_PERMITIDA[@]}"; do
    if [ ! -f "$tmp/antes/$rel" ]; then
      # Arquivo que era NOVO nesta sincronia nao tem conteudo anterior. Nao
      # apagar e deliberado (apagar infra e pior que deixar), mas tem de
      # aparecer no log: a devolucao nao foi completa.
      [ -f "$INFRA_DIR/$rel" ] && [ -z "$(awk -v r="$rel" '$2 == r { print $1 }' "$MANIFESTO" 2> /dev/null)" ] \
        && log "ATENCAO: $rel era NOVO -- nao ha conteudo anterior para devolver"
      continue
    fi
    if grava_infra "$tmp/antes/$rel" "$INFRA_DIR/$rel" "$rel"; then
      log "infra: $rel DEVOLVIDO ao conteudo anterior"
    else
      log "ERRO: nao consegui devolver $rel ao conteudo anterior"; falhou=1
    fi
  done
  grava_manifesto || falhou=1
  return $falhou
}

# O ensaio decide o ESCOPO; o health check decide se fica. Nunca
# `--remove-orphans`: ele apagaria servico que nao esta neste compose.
aplica_no_supabase() { # aplica_no_supabase <tmp> <compose_mudou> <kong_mudou>
  local tmp=$1 compose_mudou=$2 kong_mudou=$3 ensaio segs
  [ "$compose_mudou" = 0 ] && [ "$kong_mudou" = 0 ] && return 0

  if [ -z "$SUPABASE_PROJETO" ]; then
    log "ATENCAO: o compose do Supabase ou o kong.yml mudaram, e SUPABASE_PROJETO"
    log "         nao esta na configuracao -- NADA foi recriado. Os containers"
    log "         seguem com a configuracao ANTERIOR, e o deploy vai ficar verde."
    log "         Ponha SUPABASE_PROJETO=<projeto Compose do Supabase> na config."
    registra supabase_mudou_recriacao_pendente "$(decorrido)"
    return 0
  fi

  # ── prova positiva, ANTES de qualquer coisa que mude estado ──
  if ! confere_projeto_do_supabase; then
    log "      Devolvendo os arquivos de infra ao conteudo anterior."
    restaura_infra "$tmp" || log "ALERTA: a devolucao dos arquivos tambem falhou"
    registra supabase_projeto_errado "$(decorrido)"
    return 1
  fi

  # ── ensaio: quem o compose recriaria ──
  if ! ensaio=$(dc_supabase up -d --dry-run 2>&1); then
    log "ERRO: o ensaio do compose do Supabase falhou -- nada foi recriado"
    ecoa_compose "$ensaio"
    restaura_infra "$tmp" || log "ALERTA: a devolucao dos arquivos tambem falhou"
    registra supabase_ensaio_falhou "$(decorrido)"
    return 1
  fi
  ecoa_compose "$ensaio"

  # ── trava do banco: o deploy NUNCA toca o db por conta propria ──
  # Recriar o Postgres e decisao humana: encerra conexao, pode disparar
  # initdb em volume novo, e nao ha rollback que devolva o que se perdeu.
  if banco_em_risco "$ensaio"; then
    log "      O deploy NAO faz isso por conta propria -- chame um humano."
    log "      Devolvendo os arquivos de infra ao conteudo anterior."
    restaura_infra "$tmp" || log "ALERTA: a devolucao dos arquivos tambem falhou"
    registra supabase_recriaria_db "$(decorrido)"
    return 1
  fi

  # ── aplica: o compose decide quais servicos, nunca um mapa escrito a mao ──
  if [ "$compose_mudou" = 1 ]; then
    log "infra: aplicando o compose do Supabase (o compose decide o escopo)"
    dc_supabase up -d || { log "ERRO: up -d no Supabase falhou"; aplica_falhou "$tmp" "$kong_mudou"; return 1; }
  fi
  # kong.yml e bind mount: o compose NAO ve mudanca nele. Sem isto o arquivo
  # novo fica no disco e o Kong segue servindo o anterior -- medido 2x.
  if [ "$kong_mudou" = 1 ]; then
    log "infra: kong.yml mudou -- recriando o kong explicitamente (bind mount)"
    dc_supabase up -d --no-deps --force-recreate kong \
      || { log "ERRO: recriacao do kong falhou"; aplica_falhou "$tmp" "$kong_mudou"; return 1; }
  fi

  # ── health check, com as repeticoes do smoke ──
  # O smoke bate no /api/healthz do app, que desde a sonda de esquema passa
  # pelo kong e pelo PostgREST: um kong quebrado aparece aqui. E ele REPETE
  # ate ESPERA_SMOKE -- o Kong levou 9 tentativas para aceitar conexao em
  # 2026-11-28, e 3 horas antes. Conferir uma vez so reverteria mudanca boa.
  log "infra: conferindo saude depois de recriar"
  if segs=$(smoke); then
    log "infra: saudavel em ${segs}s depois da recriacao"
    return 0
  fi
  log "ERRO: depois de recriar, o app nao respondeu -- devolvendo a infra"
  aplica_falhou "$tmp" "$kong_mudou"
  return 1
}

# Volta atras: devolve os arquivos e recria com eles. Se a volta tambem nao
# responder, o deploy falha de todo jeito -- mas o registro diz qual dos dois
# estados ficou, que e o que quem for consertar precisa saber.
aplica_falhou() { # aplica_falhou <tmp> <kong_mudou>
  local tmp=$1 kong_mudou=$2
  if ! restaura_infra "$tmp"; then
    log "ALERTA: nao consegui devolver os arquivos de infra. Estado MISTO."
    registra supabase_devolucao_falhou "$(decorrido)"
    return 0
  fi
  dc_supabase up -d > /dev/null 2>&1 || log "ALERTA: up -d da devolucao falhou"
  if [ "$kong_mudou" = 1 ]; then
    dc_supabase up -d --no-deps --force-recreate kong > /dev/null 2>&1 \
      || log "ALERTA: recriacao do kong na devolucao falhou"
  fi
  if smoke > /dev/null; then
    log "infra: devolvida e saudavel -- o deploy falha, o ambiente fica de pe"
    registra supabase_devolvido_ok "$(decorrido)"
  else
    log "ALERTA: nem com a infra devolvida o app responde"
    registra supabase_devolvido_sem_saude "$(decorrido)"
  fi
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
  local compose_mudou=0 kong_mudou=0
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
    # Copia do conteudo ANTERIOR, antes de sobrescrever, para a volta atras.
    # Só para arquivo que ja existia: em arquivo NOVO nao ha o que devolver,
    # e devolver seria apagar -- que esta funcao nao faz de proposito.
    case ${acao[i]} in
      atualiza:*|adota:*)
        # `${rel%/*}` devolve o PROPRIO nome quando nao ha barra -- criar isso
        # como diretorio faria o `cp` copiar para DENTRO dele, e a devolucao
        # nao acharia o arquivo. Medido: o teste (o) reprovou exatamente nisso.
        case "$rel" in
          */*) mkdir -p "$tmp/antes/${rel%/*}" || {
                 log "ERRO: nao consegui preparar a copia anterior de $rel"; return 1; } ;;
          *)   mkdir -p "$tmp/antes" || {
                 log "ERRO: nao consegui preparar a copia anterior de $rel"; return 1; } ;;
        esac
        cp -p "$alvo" "$tmp/antes/$rel" || {
          log "ERRO: nao consegui guardar o conteudo anterior de $rel"; return 1; } ;;
    esac
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
    case ${acao[i]} in
      igual) ;;
      *) case "$rel" in
           initdb/*) initdb_mudou=1 ;;
           docker-compose.supabase.yml) compose_mudou=1 ;;
           kong.yml) kong_mudou=1 ;;
         esac ;;
    esac
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
  # Por ultimo, e DENTRO desta funcao: a volta atras precisa das copias que
  # vivem em "$tmp", e o diretorio temporario morre quando ela retorna.
  aplica_no_supabase "$tmp" "$compose_mudou" "$kong_mudou" || return 1
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

# ── preflight: a configuracao do app RESOLVE? ──
# `config -q` resolve o compose com o env e falha citando a variavel que falta.
# Sem isto, variavel ausente so aparece no `up` da etapa 4/5 -- DEPOIS das
# migrations aplicadas --, e la o rollback tenta subir a imagem anterior com O
# MESMO env quebrado, falha tambem, e registra `rollback_falhou`: o log aponta
# para o rollback quando o problema e uma linha de configuracao.
#
# Depois da sincronia da infra, de proposito: o compose que vale e o que acabou
# de ser gravado, nao o que estava em disco quando o deploy comecou.
log "preflight da configuracao do app"
if ! saida_preflight=$(APP_IMAGEM="$IMAGEM_ALVO" dc config -q 2>&1); then
  log "ERRO: a configuracao do app nao resolve -- app NAO foi trocado, nada migrado"
  ecoa_variaveis "$saida_preflight" preflight
  log "      Em geral e variavel ausente no env do ambiente. O nome dela esta acima."
  registra preflight_falhou "$(decorrido)"
  exit 1
fi
log "preflight ok: o compose do app resolve com este env"

# 3/5 ANTES do up: migration quebrada não pode conviver com app novo.
log "3/5 migrations"
# As DB_* vao EXPLICITAS para o filho. `. "$CONFIG"` cria variavel de SHELL,
# nao de ambiente: sem isto, `DB_CONTAINER=...` na configuracao simplesmente nao
# chega ao migra.sh, e so um `export` no arquivo de config faria chegar. Medido
# em 2026-11-27 -- e armadilha cara, porque o sintoma ("falta DB_CONTAINER")
# aponta para a config, que esta correta. Passar explicito tira a pegadinha da
# mao de quem escreve a configuracao.
if ! APP_IMAGEM="$IMAGEM_ALVO" \
     DB_CONTAINER="$DB_CONTAINER" \
     DB_USER="${DB_USER:-supabase_admin}" \
     DB_NOME="${DB_NOME:-postgres}" \
     "$MIGRA"; then
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
