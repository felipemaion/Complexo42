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
printf '#!/bin/sh\nexit 0\n' > "$BASE/migra.sh"; chmod +x "$BASE/migra.sh"

cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf 'APP_IMAGEM=%s %s\n' "${APP_IMAGEM:-}" "$*" >> "$STUB_CHAMADAS"
[ "$1 $2" = "compose -p" ] && case "$*" in *" ps -q app") echo cid123; exit 0 ;; esac
[ "$1 $2" = "inspect -f" ] && { printf '%s\n' "${STUB_ANTERIOR-$ANTERIOR_PADRAO}"; exit 0; }
case "$1" in
  create) exit 0 ;;
  cp) # entrega o /app/deploy que a "imagem" carrega. `cp -R origem destino`
      # com destino inexistente ja cria o destino -- nao precisa de mkdir, e
      # um mkdir mal escrito aqui suja o diretorio de trabalho do teste.
      cp -R "$STUB_INFRA_IMAGEM" "$3"; exit 0 ;;
  rm) exit 0 ;;
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
for v in PROJECT_DIR ENV_FILE COMPOSE_APP APP_PROJETO REDE_PROXY ALVO_SAUDE MIGRA SMOKE_IMAGEM; do
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
