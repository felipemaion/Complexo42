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
mkdir -p "$BASE/bin" "$BASE/deploy/data/logs" "$BASE/manifesto"
printf 'COMPOSE_PROJECT_NAME=complexo42stg\n' > "$BASE/deploy/env"   # o do SUPABASE: a armadilha
printf 'services: {app: {}}\n' > "$BASE/deploy/compose.yml"
# O duble registra o AMBIENTE que recebeu: e a unica forma de provar que as
# DB_* chegaram ao processo filho. `. "$CONFIG"` cria variavel de SHELL, e sem
# passagem explicita nada da configuracao atravessa.
cat > "$BASE/migra.sh" << 'MIGRA'
#!/bin/sh
printf 'DB_CONTAINER=[%s] DB_USER=[%s] DB_NOME=[%s] APP_IMAGEM=[%s]\n' \
  "${DB_CONTAINER:-}" "${DB_USER:-}" "${DB_NOME:-}" "${APP_IMAGEM:-}" > "$STUB_MIGRA"
exit 0
MIGRA
chmod +x "$BASE/migra.sh"

cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf 'APP_IMAGEM=%s %s\n' "${APP_IMAGEM:-}" "$*" >> "$STUB_CHAMADAS"
[ "$1 $2" = "compose -p" ] && case "$*" in *" ps -q app") echo cid123; exit 0 ;; esac
# A pergunta do LABEL vem ANTES do inspect generico: sem isto a prova
# positiva do projeto receberia a referencia da imagem anterior e falharia.
case "$*" in
  *com.docker.compose.project*)
    printf '%s\n' "${STUB_DONO_DB-${STUB_SUPA_PROJ:-}}"
    exit "${STUB_DONO_DB_SAIDA:-0}" ;;
esac
[ "$1 $2" = "inspect -f" ] && { printf '%s\n' "${STUB_ANTERIOR-$ANTERIOR_PADRAO}"; exit 0; }
case "$1" in
  create) exit 0 ;;
  cp) # Um ARQUIVO so: a lista de obrigatorias que o preflight le da imagem.
      # Vem antes do caso geral porque o caso geral copiaria o diretorio.
      case "$2" in
        *obrigatorias-em-producao.txt)
          # STUB_LISTA vazia = imagem SEM a lista: o `docker cp` falha, como
          # falharia de verdade numa imagem anterior a guarda.
          [ -n "${STUB_LISTA:-}" ] || exit 1
          # O destino e um DIRETORIO: `docker cp` nao decide nada sobre um
          # arquivo que ja existe.
          if [ "${STUB_LISTA_SYMLINK:-}" = 1 ]; then
            ln -s /etc/passwd "$3/obrigatorias-em-producao.txt"; exit 0
          fi
          printf '%s\n' "$STUB_LISTA" > "$3/obrigatorias-em-producao.txt"; exit 0 ;;
      esac
      # entrega o /app/deploy que a "imagem" carrega. `cp -R origem destino`
      # com destino inexistente ja cria o destino -- nao precisa de mkdir, e
      # um mkdir mal escrito aqui suja o diretorio de trabalho do teste.
      cp -R "$STUB_INFRA_IMAGEM" "$3"; exit 0 ;;
  rm) exit 0 ;;
  pull) exit "${STUB_PULL:-0}" ;;
  run) n=$(( $(cat "$STUB_CONTA" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_CONTA"
       case "${STUB_SMOKE:-ok}" in ok) exit 0 ;; falha_sempre) exit 1 ;;
         falha_primeiro) [ "$n" -le "${STUB_FALHAS:-3}" ] && exit 1; exit 0 ;; esac ;;
esac
# Preflight da configuracao do app: `config -q`.
case "$*" in *"config -q"*)
  [ -n "${STUB_CONFIG_SAIDA:-}" ] && printf '%s\n' "$STUB_CONFIG_SAIDA"
  exit "${STUB_CONFIG:-0}" ;;
esac
# `config` SEM -q: o compose resolvido que o preflight 2 le. Depois do
# `config -q`, que e mais especifico.
case "$*" in *" config")
  printf '%s\n' "${STUB_CONFIG_RESOLVIDO-$RESOLVIDO_PADRAO}"
  exit 0 ;;
esac
# O ensaio ANTES do `up -d` generico: ele tambem casa com *"up -d"*.
case "$*" in
  *"up -d --dry-run"*)
    printf '%s\n' "${STUB_ENSAIO:-$ENSAIO_PADRAO}"
    exit "${STUB_ENSAIO_SAIDA:-0}" ;;
esac
case "$*" in
  *"-p ${STUB_SUPA_PROJ:-naoexiste} "*" up -d"*) exit "${STUB_UP_SUPA:-0}" ;;
  *"up -d"*) exit "${STUB_UP:-0}" ;;
esac
exit 0
DUBLE
printf '#!/bin/sh\nexit ${STUB_FLOCK:-0}\n' > "$BASE/bin/flock"
printf '#!/bin/sh\nexit 0\n' > "$BASE/bin/sleep"
chmod +x "$BASE/bin"/*
ANT=ghcr.io/felipemaion/complexo42@sha256:$(printf '9%.0s' $(seq 1 64))
export PATH="$BASE/bin:$PATH" STUB_CHAMADAS="$BASE/chamadas" STUB_CONTA="$BASE/conta" ANTERIOR_PADRAO="$ANT"
# Ensaio como o compose de verdade imprime: TODOS os servicos, o banco entre
# eles e inalterado. A trava do banco exige que ele apareca.
# A lista que a "imagem" carrega e o compose resolvido do caminho feliz saem da
# LISTA DE VERDADE do repositorio: teste que carrega a sua propria copia da
# lista passa a conferir a copia, nao o contrato.
STUB_LISTA=$(grep -E '^[A-Z][A-Z0-9_]*$' "$AQUI/obrigatorias-em-producao.txt")
export STUB_LISTA
RESOLVIDO_PADRAO="services:
  app:
    environment:
$(printf '%s\n' "$STUB_LISTA" | sed 's/^/      /; s/$/: valor-qualquer/')"
export RESOLVIDO_PADRAO
export ENSAIO_PADRAO=$'Container complexo42stg-db-1  Running\nContainer complexo42stg-rest-1  Running\nContainer complexo42stg-kong-1  Recreate'
export STUB_MIGRA="$BASE/migra-recebeu"

escreve_config() {
  cat > "$BASE/deploy.conf" << CFG
PROJECT_DIR=$BASE/deploy
ENV_FILE=$BASE/deploy/env
COMPOSE_APP=$BASE/deploy/compose.yml
APP_PROJETO=complexo42stg-app
REDE_PROXY=proxy
ALVO_SAUDE=http://app:3000/api/healthz
MIGRA=$BASE/migra.sh
DB_CONTAINER=complexo42stg-db-1
SMOKE_IMAGEM=curlimages/curl@sha256:abc
ESPERA_SMOKE=3
TRAVA=$BASE/deploy.lock
MANIFESTO=$BASE/manifesto/infra
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
for v in PROJECT_DIR ENV_FILE COMPOSE_APP APP_PROJETO REDE_PROXY ALVO_SAUDE MIGRA SMOKE_IMAGEM DB_CONTAINER; do
  escreve_config "$v"; roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
  verifica "recusa config sem $v" $r
done
escreve_config

# A "imagem" que o duble de `docker cp` entrega. Montada AQUI, antes do
# caminho feliz, porque a lista de infra e obrigatoria: imagem que nao traz
# todos os arquivos da lista derruba o deploy, e e isso que o servidor veria.
IMG="$BASE/naimagem/deploy"; SRV="$BASE/deploy"
mkdir -p "$IMG/initdb"
printf 'compose v2\n' > "$IMG/docker-compose.supabase.yml"
printf 'kong v2\n'    > "$IMG/kong.yml"
printf 'ext v2\n'     > "$IMG/initdb/01-extensions.sql"
printf 'roles v2\n'   > "$IMG/initdb/02-roles.sh"
export STUB_INFRA_IMAGEM="$BASE/naimagem/deploy"
MANIF="$BASE/manifesto/infra"

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
# servidor sem infra nenhuma: o deploy grava os quatro arquivos da lista
for f in docker-compose.supabase.yml kong.yml initdb/01-extensions.sql initdb/02-roles.sh; do
  [ -f "$SRV/$f" ] && r=0 || r=1; verifica "gravou $f no servidor" $r; done
[ "$(wc -l < "$MANIF" | tr -d ' ')" = 4 ] && r=0 || r=1
verifica "e o manifesto lista os quatro" $r
# O migra.sh roda como FILHO: variavel sourceada da config nao atravessa
# sozinha. Sem passagem explicita isto vem vazio, e o deploy so descobre na
# etapa 3/5 -- depois do pull e da sincronia da infra.
grep -q 'DB_CONTAINER=\[complexo42stg-db-1\]' "$STUB_MIGRA" && r=0 || r=1
verifica "o migra.sh RECEBE o DB_CONTAINER da config" $r
grep -q 'DB_USER=\[supabase_admin\] DB_NOME=\[postgres\]' "$STUB_MIGRA" && r=0 || r=1
verifica "e os padroes de DB_USER e DB_NOME" $r
grep -q "APP_IMAGEM=\[ghcr.io/felipemaion/complexo42@$DIG\]" "$STUB_MIGRA" && r=0 || r=1
verifica "e a imagem que o deploy pediu" $r

echo "== o que o deploy aceita gravar como root"
# A lista e FIXA no script: a imagem e fonte de conteudo, nao de caminho.
for f in docker-compose.supabase.yml kong.yml initdb/01-extensions.sql initdb/02-roles.sh; do
  permitida "$f" && verifica "aceita gravar $f" 0 || verifica "aceita gravar $f" 1; done
# migra.sh e o caso que motiva a lista: o deploy o EXECUTA no passo seguinte.
for f in migra.sh deploy.sh docker-compose.app.yml env secrets/env .env backup.sh initdb/03-novo.sql; do
  permitida "$f" && verifica "RECUSA gravar $f" 1 || verifica "RECUSA gravar $f" 0; done

nome_seguro "kong.yml" && verifica "nome comum passa" 0 || verifica "nome comum passa" 1
nome_seguro "initdb/02-roles.sh" && verifica "nome com subdiretorio passa" 0 || verifica "nome com subdiretorio passa" 1
for n in "../fora" "a/../../b" "-rf" "com espaco" "$(printf 'ma\nu')" "" "ponto;virgula"; do
  nome_seguro "$n" && verifica "recusa nome '${n:0:12}'" 1 || verifica "recusa nome '${n:0:12}'" 0; done

echo "== nenhum componente do caminho pode ser link"
LK=$(mktemp -d); mkdir -p "$LK/real/initdb" "$LK/fora"
INFRA_DIR="$LK/real" sem_links "initdb/02-roles.sh" > /dev/null 2>&1 \
  && verifica "caminho sem link passa" 0 || verifica "caminho sem link passa" 1
ln -s "$LK/fora" "$LK/real/link"
INFRA_DIR="$LK/real" sem_links "link/02-roles.sh" > /dev/null 2>&1 \
  && verifica "DIRETORIO intermediario que e link derruba" 1 || verifica "DIRETORIO intermediario que e link derruba" 0
ln -s /etc/passwd "$LK/real/initdb/alvo"
INFRA_DIR="$LK/real" sem_links "initdb/alvo" > /dev/null 2>&1 \
  && verifica "ALVO que e link derruba" 1 || verifica "ALVO que e link derruba" 0
ln -s "$LK/real" "$LK/raiz"
INFRA_DIR="$LK/raiz" sem_links "initdb/02-roles.sh" > /dev/null 2>&1 \
  && verifica "proprio INFRA_DIR que e link derruba" 1 || verifica "proprio INFRA_DIR que e link derruba" 0
rm -rf "$LK"

echo "== sincronia da infra (ADR 0015)"

# (a) servidor igual a imagem: nao troca nada e nao reclama
cp "$IMG/docker-compose.supabase.yml" "$SRV/"; cp "$IMG/kong.yml" "$SRV/"
mkdir -p "$SRV/initdb"; cp "$IMG/initdb/02-roles.sh" "$IMG/initdb/01-extensions.sql" "$SRV/initdb/"
rm -f "$MANIF"
roda "$DIG"; verifica "infra igual a imagem: deploy segue" $?
grep -q 'infra: tudo igual a imagem' "$BASE/saida" && r=0 || r=1
verifica "e diz que estava tudo igual" $r
[ -s "$MANIF" ] && r=0 || r=1; verifica "grava o manifesto do que deixou" $r

# (b) imagem mudou e o local e o que o deploy gravou: troca e REGISTRA
printf 'compose v3\n' > "$IMG/docker-compose.supabase.yml"
roda "$DIG"; verifica "imagem nova com local conhecido: deploy segue" $?
grep -q 'infra: docker-compose.supabase.yml' "$BASE/saida" && r=0 || r=1
verifica "registra o arquivo trocado com os dois sha" $r
grep -q 'compose v3' "$SRV/docker-compose.supabase.yml" && r=0 || r=1
verifica "e o arquivo no servidor virou o da imagem" $r

# (c) alguem editou a mao: FALHA FECHADO, sem sobrescrever
printf 'editado a mao\n' > "$SRV/kong.yml"
printf 'kong v3\n' > "$IMG/kong.yml"
roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
verifica "divergencia local nao vinda do deploy DERRUBA o deploy" $r
grep -q 'editado a mao' "$SRV/kong.yml" && r=0 || r=1
verifica "e NAO sobrescreve o arquivo editado (a pista fica)" $r
grep -q 'adotar-infra' "$BASE/saida" && r=0 || r=1
verifica "e diz como resolver" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e o app NAO chega a subir" $r

# (d) --adotar-infra aceita a versao da imagem
: > "$STUB_CHAMADAS"
PROJECT_DIR="$SRV" bash "$SCRIPT" --adotar-infra --config "$BASE/deploy.conf" "$DIG" > "$BASE/saida" 2>&1
verifica "--adotar-infra sai 0" $?
grep -q 'kong v3' "$SRV/kong.yml" && r=0 || r=1
verifica "e passa a valer a versao da imagem" $r
grep -q 'ADOTADO' "$BASE/saida" && r=0 || r=1
verifica "registrando que foi adocao, nao atualizacao normal" $r

# (e) initdb mudou: avisa que a recriacao do volume e manual
printf 'roles v3\n' > "$IMG/initdb/02-roles.sh"
roda "$DIG"; verifica "initdb novo: deploy segue" $?
grep -q 'initdb/ mudou' "$BASE/saida" && r=0 || r=1
verifica "avisa que o initdb mudou" $r
grep -q 'recriar o volume\|Recriar o volume' "$BASE/saida" && r=0 || r=1
verifica "e que recriar o volume e acao MANUAL" $r
grep -q 'initdb_mudou_recriacao_pendente' "$LOG" && r=0 || r=1
verifica "e deixa isso no deploy.log, nao so na tela" $r

# (f) arquivo NOVO em initdb/ tambem dispara o aviso -- antes o `case` estava
#     so no ramo do arquivo que ja existia, e era o caso que mais importa.
rm -f "$SRV/initdb/01-extensions.sql"
roda "$DIG"; verifica "initdb com arquivo NOVO: deploy segue" $?
grep -q 'initdb/ mudou' "$BASE/saida" && r=0 || r=1
verifica "e arquivo NOVO em initdb/ tambem avisa" $r

# (g) a imagem NAO decide o que o root grava: arquivo fora da lista derruba.
#     Este e o caminho que levava a root -- a imagem traria migra.sh, o deploy
#     gravaria por cima, e o passo 3/5 o executa.
printf 'exit 1\n' > "$IMG/migra.sh"
roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
verifica "arquivo FORA da lista na imagem derruba o deploy" $r
grep -q 'fora da lista de infra: migra.sh' "$BASE/saida" && r=0 || r=1
verifica "e diz qual arquivo sobrou" $r
[ ! -e "$SRV/migra.sh" ] && r=0 || r=1
verifica "e NAO grava o arquivo sobrando no servidor" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e o app NAO chega a subir" $r
rm -f "$IMG/migra.sh"

# (h) nome hostil na imagem: recusado sem ser impresso
MAU="$IMG/$(printf 'ma\nu')"; printf 'x\n' > "$MAU"
roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
verifica "nome com QUEBRA DE LINHA na imagem derruba o deploy" $r
grep -q 'nome de arquivo recusado' "$BASE/saida" && r=0 || r=1
verifica "e recusa sem imprimir o nome" $r
rm -f "$MAU"

# (i) link simbolico na imagem com nome permitido: `cat` leria o destino NO
#     HOST, e o deploy gravaria /etc/passwd como kong.yml no servidor.
mv "$IMG/kong.yml" "$IMG/kong.yml.guardado"; ln -s /etc/passwd "$IMG/kong.yml"
roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
verifica "LINK na imagem derruba o deploy" $r
grep -q 'link simbolico' "$BASE/saida" && r=0 || r=1
verifica "e diz que era link" $r
grep -q 'root:' "$SRV/kong.yml" && r=1 || r=0
verifica "e o conteudo do host NAO vaza para o servidor" $r
rm -f "$IMG/kong.yml"; mv "$IMG/kong.yml.guardado" "$IMG/kong.yml"

# (j) diretorio de destino que e link: o root escreveria FORA do deploy
printf 'ext v3\n' > "$IMG/initdb/01-extensions.sql"
mkdir -p "$BASE/fora"; mv "$SRV/initdb" "$SRV/initdb.guardado"; ln -s "$BASE/fora" "$SRV/initdb"
roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
verifica "diretorio de destino que e LINK derruba o deploy" $r
[ ! -e "$BASE/fora/01-extensions.sql" ] && r=0 || r=1
verifica "e nada e escrito do outro lado do link" $r
rm -f "$SRV/initdb"; mv "$SRV/initdb.guardado" "$SRV/initdb"

# (k) gravacao que FALHA derruba o deploy. Era o furo do `if !`: ali o set -e
#     nao vale, o corpo seguia depois do erro e o manifesto registrava o que
#     nao tinha sido escrito.
printf 'compose v9\n' > "$IMG/docker-compose.supabase.yml"
roda "$DIG" > /dev/null 2>&1   # deixa o manifesto em dia com o local
chmod 500 "$SRV"
printf 'compose v10\n' > "$IMG/docker-compose.supabase.yml"
roda "$DIG"; [ $? -ne 0 ] && r=0 || r=1
verifica "gravacao que falha DERRUBA o deploy (nao segue calada)" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e o app NAO chega a subir" $r
chmod 755 "$SRV"
grep -q 'compose v10' "$MANIF" 2>/dev/null && r=1 || r=0
verifica "e o manifesto NAO registra o que nao foi escrito" $r

# (l) break-glass nao reescreve infra: a imagem vem por TAG, ponteiro movel.
#     E divergencia na infra nao pode impedir de restabelecer servico.
printf 'editado a mao de novo\n' > "$SRV/kong.yml"
: > "$STUB_CHAMADAS"
roda emergencia:sha-abc1234; verifica "emergencia sai 0 mesmo com infra divergente" $?
grep -q 'PULADA no modo emergencia' "$BASE/saida" && r=0 || r=1
verifica "e diz que pulou a sincronia" $r
grep -q 'editado a mao de novo' "$SRV/kong.yml" && r=0 || r=1
verifica "e nao toca na infra do servidor" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=0 || r=1
verifica "e o app SOBE (e o que o break-glass quer)" $r
# volta o servidor ao estado da imagem, para os testes seguintes
cp "$IMG/kong.yml" "$SRV/kong.yml"; cp "$IMG/docker-compose.supabase.yml" "$SRV/"
cp "$IMG/initdb/01-extensions.sql" "$IMG/initdb/02-roles.sh" "$SRV/initdb/"
roda "$DIG" > /dev/null 2>&1

echo "== recriacao seletiva do Supabase (gravar nao e aplicar)"
# Deixa servidor e imagem iguais, para partir de um estado limpo.
cp "$IMG/docker-compose.supabase.yml" "$SRV/"; cp "$IMG/kong.yml" "$SRV/"
cp "$IMG/initdb/01-extensions.sql" "$IMG/initdb/02-roles.sh" "$SRV/initdb/"
rm -f "$MANIF"; roda "$DIG" > /dev/null 2>&1

# (i) sem SUPABASE_PROJETO: nao recria NADA, mas grita e registra.
printf 'compose v4\n' > "$IMG/docker-compose.supabase.yml"
roda "$DIG"; verifica "sem SUPABASE_PROJETO: o deploy segue" $?
grep -q 'NADA foi recriado' "$BASE/saida" && r=0 || r=1
verifica "e avisa, alto, que nada foi recriado" $r
grep -q 'supabase_mudou_recriacao_pendente' "$LOG" && r=0 || r=1
verifica "e deixa isso no deploy.log, nao so na tela" $r
grep -q 'dry-run' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e nem ensaia: sem o nome do projeto, nao se adivinha" $r

# A partir daqui, com o projeto do Supabase configurado.
export STUB_SUPA_PROJ=stgsupa
printf 'SUPABASE_PROJETO=stgsupa\n' >> "$BASE/deploy.conf"

# (j) o compose do Supabase mudou: ensaia e aplica, e o compose decide o escopo
printf 'compose v5\n' > "$IMG/docker-compose.supabase.yml"
roda "$DIG"; verifica "compose do Supabase mudou: deploy segue" $?
grep -q -- '-p stgsupa .* up -d --dry-run' "$STUB_CHAMADAS" && r=0 || r=1
verifica "ENSAIA antes de aplicar" $r
grep -qE -- '-p stgsupa .* up -d$' "$STUB_CHAMADAS" && r=0 || r=1
verifica "e aplica com up -d, deixando o compose decidir o escopo" $r
grep -q -- 'up -d --remove-orphans' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e NUNCA com --remove-orphans" $r
grep -q 'ensaio:' "$BASE/saida" && r=0 || r=1
verifica "e registra no log o que o ensaio previu" $r

# (k) a ORDEM importa: ensaio antes do up. Aplicar e depois ensaiar nao serve.
o_ensaio=$(grep -n 'up -d --dry-run' "$STUB_CHAMADAS" | head -n1 | cut -d: -f1)
o_up=$(grep -nE -- '-p stgsupa .* up -d$' "$STUB_CHAMADAS" | head -n1 | cut -d: -f1)
[ -n "$o_ensaio" ] && [ -n "$o_up" ] && [ "$o_ensaio" -lt "$o_up" ] && r=0 || r=1
verifica "o ensaio vem ANTES do up" $r

# (l) kong.yml e bind mount: exige recriacao EXPLICITA
printf 'kong v5\n' > "$IMG/kong.yml"
roda "$DIG"; verifica "kong.yml mudou: deploy segue" $?
grep -q -- 'up -d --no-deps --force-recreate kong' "$STUB_CHAMADAS" && r=0 || r=1
verifica "recria o kong explicitamente (--no-deps --force-recreate)" $r
grep -q 'bind mount' "$BASE/saida" && r=0 || r=1
verifica "e diz por que precisou (o compose nao ve bind mount)" $r

# (m) so o initdb mudou: NADA de up no Supabase -- ele so roda em volume novo
printf 'roles v5\n' > "$IMG/initdb/02-roles.sh"
roda "$DIG"; verifica "so initdb mudou: deploy segue" $?
grep -q -- '-p stgsupa' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e NAO mexe no Supabase por causa do initdb" $r
grep -q 'initdb/ mudou' "$BASE/saida" && r=0 || r=1
verifica "mas segue avisando do initdb" $r

# (n) nada mudou: nem ensaio
roda "$DIG"; verifica "nada mudou: deploy segue" $?
grep -q 'dry-run' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e nem ensaia quando nada mudou" $r

# (o) o ensaio diz que o BANCO seria recriado: FALHA, e devolve o arquivo
printf 'compose v6\n' > "$IMG/docker-compose.supabase.yml"
: > "$STUB_MIGRA"
antes_do_banco=$(cat "$SRV/docker-compose.supabase.yml")
STUB_ENSAIO='Container complexo42stg-db-1  Recreate' roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "ensaio recriando o BANCO derruba o deploy" $r
grep -q 'NAO faz isso por conta propria' "$BASE/saida" && r=0 || r=1
verifica "e diz que isso e decisao humana" $r
[ "$(cat "$SRV/docker-compose.supabase.yml")" = "$antes_do_banco" ] && r=0 || r=1
verifica "e DEVOLVE o arquivo ao conteudo anterior" $r
grep -q 'supabase_recriaria_db' "$LOG" && r=0 || r=1
verifica "e registra o motivo no deploy.log" $r
[ ! -s "$STUB_MIGRA" ] && r=0 || r=1
verifica "e as migrations NAO rodam (falha na etapa 2/5)" $r
grep -qE -- '-p stgsupa .* up -d$' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e nao chega a aplicar nada" $r

# (p) saude nao volta depois de recriar: devolve, recria com o antigo, e falha
: > "$STUB_MIGRA"
antes_da_saude=$(cat "$SRV/docker-compose.supabase.yml")
STUB_SMOKE=falha_sempre roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "saude ausente depois de recriar derruba o deploy" $r
[ "$(cat "$SRV/docker-compose.supabase.yml")" = "$antes_da_saude" ] && r=0 || r=1
verifica "e devolve o arquivo anterior" $r
grep -q 'supabase_devolvido_sem_saude' "$LOG" && r=0 || r=1
verifica "e registra o estado EXATO: devolvido e ainda sem saude" $r
[ ! -s "$STUB_MIGRA" ] && r=0 || r=1
verifica "e as migrations NAO rodam" $r
# O manifesto tem de voltar a casar com o disco: se nao, o deploy SEGUINTE
# trava lendo o arquivo devolvido como "editado a mao".
sha_disco=$(shasum -a 256 "$SRV/docker-compose.supabase.yml" 2> /dev/null | cut -d" " -f1 \
  || sha256sum "$SRV/docker-compose.supabase.yml" | cut -d" " -f1)
grep -q "$sha_disco" "$MANIF" && r=0 || r=1
verifica "e o MANIFESTO volta a casar com o disco (nao trava o proximo deploy)" $r

# (q) BLOQUEANTE achado em revisao: projeto errado subiria uma SEGUNDA pilha.
#     A trava e prova POSITIVA -- o banco conhecido tem de ser do projeto em
#     que vamos agir --, e acontece ANTES de qualquer coisa que mude estado.
printf 'compose v7\n' > "$IMG/docker-compose.supabase.yml"
: > "$STUB_MIGRA"
antes_do_projeto=$(cat "$SRV/docker-compose.supabase.yml")
STUB_DONO_DB=projeto-de-outro-ambiente roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "projeto errado (banco e de outro projeto) DERRUBA o deploy" $r
grep -q 'pertence ao projeto projeto-de-outro-ambiente' "$BASE/saida" && r=0 || r=1
verifica "e diz de quem o banco e, de verdade" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e NAO chega a ensaiar nem a aplicar nada" $r
[ "$(cat "$SRV/docker-compose.supabase.yml")" = "$antes_do_projeto" ] && r=0 || r=1
verifica "e devolve o arquivo" $r
grep -q 'supabase_projeto_errado' "$LOG" && r=0 || r=1
verifica "e registra o motivo" $r
[ ! -s "$STUB_MIGRA" ] && r=0 || r=1
verifica "e as migrations NAO rodam" $r

# (r) nao consegui provar: tambem falha FECHADO
: > "$STUB_MIGRA"
STUB_DONO_DB= STUB_DONO_DB_SAIDA=1 roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "sem conseguir ler o projeto do banco: falha FECHADO" $r
grep -q 'Sem essa prova eu NAO mexo' "$BASE/saida" && r=0 || r=1
verifica "e diz que sem prova nao age" $r
grep -q 'up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e nao age mesmo" $r

# (s) o ensaio nao menciona o banco: silencio nao e tranquilizador
: > "$STUB_MIGRA"
STUB_ENSAIO='Container outra-coisa-1  Recreate' roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "ensaio sem mencionar o banco DERRUBA o deploy" $r
grep -q 'nao e silencio tranquilizador' "$BASE/saida" && r=0 || r=1
verifica "e explica por que" $r

# (t) o banco apareceria como Create -- o caso da pilha nova
: > "$STUB_MIGRA"
STUB_ENSAIO='Container complexo42stg-db-1  Creating' roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "banco em Creating DERRUBA o deploy (pilha nova)" $r

# (u) e em Stop/Remove tambem
: > "$STUB_MIGRA"
STUB_ENSAIO='Container complexo42stg-db-1  Removed' roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "banco em Removed DERRUBA o deploy" $r

# (v) banco apenas Running: segue. E o caminho normal, e precisa passar.
: > "$STUB_MIGRA"
STUB_ENSAIO=$'Container complexo42stg-db-1  Running\nContainer complexo42stg-kong-1  Recreate' \
  roda "$DIG"
verifica "banco Running nao e risco: o deploy segue" $?
grep -qE -- '-p stgsupa .* up -d$' "$STUB_CHAMADAS" && r=0 || r=1
verifica "e aplica" $r

# (w) o ensaio falhando derruba, sem aplicar (usa o STUB_ENSAIO_SAIDA)
: > "$STUB_MIGRA"
printf 'compose v8\n' > "$IMG/docker-compose.supabase.yml"
STUB_ENSAIO_SAIDA=1 roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "ensaio falhando derruba o deploy" $r
grep -q 'supabase_ensaio_falhou' "$LOG" && r=0 || r=1
verifica "e registra que foi o ensaio" $r
grep -qE -- '-p stgsupa .* up -d$' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e nao aplica depois de ensaio que falhou" $r

# (x) o up do Supabase falhando devolve e derruba (usa o STUB_UP_SUPA)
: > "$STUB_MIGRA"
antes_do_up=$(cat "$SRV/docker-compose.supabase.yml")
STUB_UP_SUPA=1 roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "up -d no Supabase falhando derruba o deploy" $r
[ "$(cat "$SRV/docker-compose.supabase.yml")" = "$antes_do_up" ] && r=0 || r=1
verifica "e devolve o arquivo" $r
[ ! -s "$STUB_MIGRA" ] && r=0 || r=1
verifica "e as migrations NAO rodam" $r

# (y) so o kong.yml mudou e a saude nao volta: devolve o KONG, nao o compose
: > "$STUB_MIGRA"
printf 'kong v8\n' > "$IMG/kong.yml"
antes_do_kong=$(cat "$SRV/kong.yml")
STUB_SMOKE=falha_sempre roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "so o kong mudando, saude ausente derruba o deploy" $r
[ "$(cat "$SRV/kong.yml")" = "$antes_do_kong" ] && r=0 || r=1
verifica "e devolve o kong.yml ao conteudo anterior" $r
grep -q -- 'force-recreate kong' "$STUB_CHAMADAS" && r=0 || r=1
verifica "e recriou o kong na devolucao tambem" $r

unset STUB_SUPA_PROJ
escreve_config
cp "$IMG/docker-compose.supabase.yml" "$SRV/"; cp "$IMG/kong.yml" "$SRV/"
cp "$IMG/initdb/01-extensions.sql" "$IMG/initdb/02-roles.sh" "$SRV/initdb/"
rm -f "$MANIF"; roda "$DIG" > /dev/null 2>&1

echo "== preflight da configuracao do app (antes das migrations)"
: > "$STUB_MIGRA"
roda "$DIG"; verifica "caminho feliz: deploy segue" $?
grep -q -- 'config -q' "$STUB_CHAMADAS" && r=0 || r=1
verifica "o preflight RODA no caminho feliz" $r
grep -q 'preflight ok' "$BASE/saida" && r=0 || r=1
verifica "e diz que resolveu" $r
o_pre=$(grep -n -- 'config -q' "$STUB_CHAMADAS" | head -n1 | cut -d: -f1)
o_up=$(grep -nE -- '-p complexo42stg-app .* up -d' "$STUB_CHAMADAS" | head -n1 | cut -d: -f1)
[ -n "$o_pre" ] && { [ -z "$o_up" ] || [ "$o_pre" -lt "$o_up" ]; } && r=0 || r=1
verifica "e vem ANTES do up do app" $r

: > "$STUB_MIGRA"
STUB_CONFIG=1 roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "configuracao que nao resolve DERRUBA o deploy" $r
grep -q 'nada migrado' "$BASE/saida" && r=0 || r=1
verifica "e diz que nada foi migrado" $r
[ ! -s "$STUB_MIGRA" ] && r=0 || r=1
verifica "e as migrations NAO rodam (era isso que o preflight existe para evitar)" $r
grep -q 'preflight_falhou' "$LOG" && r=0 || r=1
verifica "e registra preflight_falhou, nao rollback_falhou" $r
grep -q 'rollback' "$BASE/saida" && r=1 || r=0
verifica "e NAO fala de rollback: nao houve troca para desfazer" $r
grep -qE -- '-p complexo42stg-app .* up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e o app NAO e trocado" $r

echo "== as obrigatorias CHEGAM ao container (preflight 2)"
# `config -q` responde "o compose resolve". Nao responde "o app recebe o que
# exige": variavel que o compose do SERVIDOR nao lista nao aparece em lugar
# nenhum. Foi o login do staging em 2026-11-28.
: > "$STUB_MIGRA"
roda "$DIG"; verifica "caminho feliz: as obrigatorias chegam" $?
grep -qE 'as [0-9]+ obrigatorias chegam ao container' "$BASE/saida" && r=0 || r=1
verifica "e o deploy diz quantas conferiu" $r

# Uma ausente: o nome dela tem de aparecer, e nada pode ser migrado ou trocado.
export STUB_CONFIG_RESOLVIDO="services:
  app:
    environment:
      DB_HEALTH_URL: http://rest:3001/ready
      SUPABASE_URL: http://kong:8000"
: > "$STUB_MIGRA"
roda "$DIG"; verifica "obrigatoria ausente no compose derruba o deploy" $(( $? == 0 ? 1 : 0 ))
grep -q 'BLIND_INDEX_KEY' "$BASE/saida" && r=0 || r=1
verifica "e diz o NOME da que falta" $r
grep -q 'obrigatoria_ausente' "$LOG" && r=0 || r=1
verifica "e registra obrigatoria_ausente" $r
[ -s "$STUB_MIGRA" ] && r=1 || r=0
verifica "e as migrations NAO rodam" $r
grep -qE -- '-p complexo42stg-app .* up -d' "$STUB_CHAMADAS" && r=1 || r=0
verifica "e o app NAO e trocado" $r

# Presente com valor VAZIO e o mesmo que ausente: foi assim que o compose do
# servidor "tinha" a variavel sem entregar nada.
export STUB_CONFIG_RESOLVIDO="services:
  app:
    environment:
$(printf '%s\n' "$STUB_LISTA" | sed 's/^/      /; s/$/: valor/' | sed 's/^      BLIND_INDEX_KEY: valor/      BLIND_INDEX_KEY: ""/')"
roda "$DIG"; verifica "obrigatoria com valor VAZIO conta como ausente" $(( $? == 0 ? 1 : 0 ))
grep -q 'BLIND_INDEX_KEY' "$BASE/saida" && r=0 || r=1
verifica "e tambem diz o nome dela" $r
unset STUB_CONFIG_RESOLVIDO

echo "== o preflight 2 nao imprime VALOR de variavel"
export STUB_CONFIG_RESOLVIDO="services:
  app:
    environment:
      DB_HEALTH_URL: http://rest:3001/ready
      FIELD_ENCRYPTION_KEY: SEGREDO-que-nao-pode-sair-no-log"
roda "$DIG" > /dev/null 2>&1
grep -q 'SEGREDO-que-nao-pode-sair-no-log' "$BASE/saida" && r=1 || r=0
verifica "o valor nao vai para a saida" $r
grep -q 'SEGREDO-que-nao-pode-sair-no-log' "$LOG" && r=1 || r=0
verifica "nem para o log do root" $r
unset STUB_CONFIG_RESOLVIDO

echo "== imagem sem a lista: recusa no normal, segue no break-glass"
# No modo normal a imagem vem de um build da main, que SEMPRE traz a lista:
# faltar e sinal de imagem errada. No break-glass a imagem vem por tag e pode
# ser antiga -- ali recusar custaria o restabelecimento do servico.
STUB_LISTA_GUARDADA=$STUB_LISTA
export STUB_LISTA=
: > "$STUB_MIGRA"
roda "$DIG"; verifica "imagem sem a lista derruba o deploy normal" $(( $? == 0 ? 1 : 0 ))
grep -q 'obrigatorias-em-producao.txt' "$BASE/saida" && r=0 || r=1
verifica "e diz qual arquivo falta na imagem" $r
[ -s "$STUB_MIGRA" ] && r=1 || r=0
verifica "e nada e migrado" $r

roda emergencia:sha-abc1234; verifica "no break-glass o deploy SEGUE sem a lista" $?
grep -q 'ALERTA' "$BASE/saida" && r=0 || r=1
verifica "e avisa que a conferencia nao foi feita" $r
export STUB_LISTA=$STUB_LISTA_GUARDADA

echo "== lista malformada na imagem: RECUSA, nao descarta em silencio"
# Apontado na revisao: o CI validava a linha com strip e o deploy filtrava a
# linha crua. Espaco no fim passava no CI e o nome desaparecia aqui -- a
# conferencia seguia "ok" conferindo uma variavel menos.
STUB_LISTA_GUARDADA=$STUB_LISTA
export STUB_LISTA="DB_HEALTH_URL
BLIND_INDEX_KEY "
: > "$STUB_MIGRA"
roda "$DIG"; verifica "nome com espaco no fim derruba o deploy" $(( $? == 0 ? 1 : 0 ))
grep -q 'nao sao nome de' "$BASE/saida" && r=0 || r=1
verifica "e diz que recusou a linha, em vez de descartar" $r
[ -s "$STUB_MIGRA" ] && r=1 || r=0
verifica "e nada e migrado" $r

export STUB_LISTA=$(printf 'DB_HEALTH_URL\nBLIND_INDEX_KEY\r')
roda "$DIG"; verifica "CR no fim (CRLF) tambem derruba" $(( $? == 0 ? 1 : 0 ))

export STUB_LISTA=$STUB_LISTA_GUARDADA
export STUB_LISTA_SYMLINK=1
roda "$DIG"; verifica "lista que e symlink na imagem derruba o deploy" $(( $? == 0 ? 1 : 0 ))
grep -q 'nao e arquivo comum' "$BASE/saida" && r=0 || r=1
verifica "e diz que nao e arquivo comum" $r
unset STUB_LISTA_SYMLINK

echo "== YAML nulo conta como vazio"
export STUB_CONFIG_RESOLVIDO="services:
  app:
    environment:
$(printf '%s\n' "$STUB_LISTA" | sed 's/^/      /; s/$/: valor/' | sed 's/^      BLIND_INDEX_KEY: valor/      BLIND_INDEX_KEY: null/')"
roda "$DIG"; verifica "obrigatoria com valor null conta como ausente" $(( $? == 0 ? 1 : 0 ))
grep -q 'BLIND_INDEX_KEY' "$BASE/saida" && r=0 || r=1
verifica "e diz o nome dela" $r
unset STUB_CONFIG_RESOLVIDO

echo "== nem o ENSAIO do Supabase leva valor do env para o log"
# Mesmo --env-file, mesma forma de erro: apontado na revisao do #284.
export STUB_SUPA_PROJ=stgsupa
printf 'SUPABASE_PROJETO=stgsupa\n' >> "$BASE/deploy.conf"
printf 'compose v9\n' > "$IMG/docker-compose.supabase.yml"
: > "$STUB_MIGRA"
STUB_ENSAIO_SAIDA=1 \
STUB_ENSAIO='unexpected character "x" in variable name near "SEGREDO=zzz-do-ensaio"' \
  roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "ensaio ilegivel derruba o deploy" $r
grep -q 'zzz-do-ensaio' "$BASE/saida" && r=1 || r=0
verifica "e o VALOR nao aparece na saida" $r
grep -q 'zzz-do-ensaio' "$LOG" && r=1 || r=0
verifica "nem no deploy.log" $r
unset STUB_SUPA_PROJ
escreve_config
cp "$IMG/docker-compose.supabase.yml" "$SRV/"; rm -f "$MANIF"
roda "$DIG" > /dev/null 2>&1

echo "== o preflight nao leva valor do env para o log do root"
# Erro de dotenv tem a forma `... in variable name near "CHAVE=valor"`: filtrar
# por linha casaria "variable" e levaria o VALOR. Apontado em revisao do #284.
: > "$STUB_MIGRA"
STUB_CONFIG=1 \
STUB_CONFIG_SAIDA='unexpected character "x" in variable name near "SEGREDO=xyz-super-secreto"' \
  roda "$DIG"
[ $? -ne 0 ] && r=0 || r=1
verifica "saida ilegivel do compose ainda derruba o deploy" $r
grep -q 'SEGREDO=xyz-super-secreto' "$BASE/saida" && r=1 || r=0
verifica "e o VALOR nao aparece na saida" $r
grep -q 'xyz-super-secreto' "$LOG" && r=1 || r=0
verifica "nem no deploy.log" $r
grep -q 'omitidas de proposito' "$BASE/saida" && r=0 || r=1
verifica "e diz que omitiu de proposito" $r

# E quando o compose fala a lingua esperada, o NOME aparece -- so ele.
: > "$STUB_MIGRA"
STUB_CONFIG=1 \
STUB_CONFIG_SAIDA='required variable FIELD_ENCRYPTION_KEY is missing a value: obrigatorio' \
  roda "$DIG"
grep -q 'variavel sem valor: FIELD_ENCRYPTION_KEY' "$BASE/saida" && r=0 || r=1
verifica "nome da variavel ausente aparece no log" $r
grep -q 'is missing a value' "$BASE/saida" && r=1 || r=0
verifica "e o resto da linha do compose nao" $r

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
