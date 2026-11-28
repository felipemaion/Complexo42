#!/usr/bin/env bash
# Teste do vigia.sh (#85) com dublês de df, docker, openssl e curl: sem servidor, sem rede. Confere
# os limiares, as 2 medições seguidas, o aviso só na transição, o lembrete, o "resolvido", o modo
# sem ALERTA_PARA (só registro) e que a senha do SMTP não vai para argumento de processo nem para o log.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/vigia.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT
mkdir -p "$BASE/bin" "$BASE/backups/diario" "$BASE/estado"

# df: uso em % vem de $BASE/uso-<caminho com / trocado por _> (padrão 40).
cat > "$BASE/bin/df" << 'DUBLE'
#!/usr/bin/env bash
alvo=${!#}; f="$STUB/uso-$(printf '%s' "$alvo" | tr '/' '_')"
uso=$(cat "$f" 2> /dev/null || echo 40)
printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/x 100 %s 0 %s%% %s\n' "$uso" "$uso" "$alvo"
DUBLE
# docker: `ps` lista $STUB/containers; `stats` lista $STUB/memoria.
cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
[ -n "${STUB_DOCKER_FORA:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
case "$1" in
  ps)    cat "$STUB/containers" ;;
  stats) cat "$STUB/memoria" ;;
esac
DUBLE
# openssl: `x509 -checkend` sai 0 se o certificado vale além do prazo ($STUB/cert-ok existe).
cat > "$BASE/bin/openssl" << 'DUBLE'
#!/usr/bin/env bash
case "$1" in
  s_client) cat > /dev/null; echo "-----BEGIN CERTIFICATE-----" ;;
  x509) cat > /dev/null; [ -f "$STUB/cert-ok" ] ;;
esac
DUBLE
# curl: grava a linha de comando, o arquivo de -K e o e-mail (stdin), um por chamada.
cat > "$BASE/bin/curl" << 'DUBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB/curl-args"
cfg=
for a in "$@"; do
  if [ -n "$cfg" ]; then cat "$a" >> "$STUB/curl-config"; cfg=; fi
  case "$a" in -K|--config) cfg=1 ;; esac
done
{ echo "=== e-mail"; cat; } >> "$STUB/emails"
DUBLE
chmod +x "$BASE/bin/"*
export PATH="$BASE/bin:$PATH" STUB="$BASE"

printf 'SMTP_HOST=relay.exemplo.org\nSMTP_PORT=587\nSMTP_USER=usuario-relay\nSMTP_PASS=senha-do-relay-de-teste\n' > "$BASE/segredos"
export AMBIENTE=teste ESTADO_DIR="$BASE/estado" REGISTRO="$BASE/vigia.log" ENV_FILE="$BASE/segredos" \
  DISCOS="/ /dados" PROJETOS="teste teste-app" BACKUP_DIR="$BASE/backups" CERT_HOST=site.exemplo.org \
  ALERTA_DE=alertas@exemplo.org ALERTA_PARA=mantenedor@exemplo.org
touch "$BASE/cert-ok" "$BASE/backups/diario/postgres-1.dump.age"
printf 'teste-db-1 Up 2 hours (healthy)\nteste-app-app-1 Up 2 hours\n' > "$BASE/containers"
printf 'teste-db-1 30.00%%\nteste-app-app-1 50.00%%\n' > "$BASE/memoria"

AGORA=1000000
roda() { : > "$BASE/emails"; VIGIA_AGORA=$AGORA bash "$SCRIPT" > "$BASE/saida" 2>&1; RC=$?; AGORA=$((AGORA + 300)); }
emails() { grep -c '^=== e-mail' "$BASE/emails" 2> /dev/null || true; }
assunto() { grep -m1 '^Subject:' "$BASE/emails"; }

# --- tudo bem: nenhum e-mail ---------------------------------------------------------------
roda
{ [ "$RC" = 0 ] && [ "$(emails)" = 0 ]; }; verifica "tudo ok: sai 0 e não manda e-mail" $?

# --- disco: 1ª medição ruim não alerta; a 2ª, sim; a 3ª, não repete -------------------------
echo 85 > "$BASE/uso-_"
roda; [ "$(emails)" = 0 ]; verifica "disco a 85%, 1ª medição: ainda não alerta" $?
roda; [ "$(emails)" = 1 ]; verifica "2ª medição seguida: alerta" $?
{ assunto | grep -q 'ALERTA' && assunto | grep -q 'disco' && assunto | grep -q 'teste'; }; verifica "assunto diz ALERTA, disco e o ambiente" $?
grep -q '85%' "$BASE/emails"; verifica "o corpo traz o uso medido" $?
roda; [ "$(emails)" = 0 ]; verifica "3ª medição: não repete o e-mail (aviso só na transição)" $?
AGORA=$((AGORA + 6 * 3600)); roda
{ [ "$(emails)" = 1 ] && assunto | grep -q 'LEMBRETE'; }; verifica "6 h depois, ainda ruim: um lembrete" $?
echo 40 > "$BASE/uso-_"
roda; { [ "$(emails)" = 1 ] && assunto | grep -q 'RESOLVIDO'; }; verifica "voltou ao normal: avisa que resolveu" $?
roda; [ "$(emails)" = 0 ]; verifica "e depois não manda mais nada" $?

# --- oscilação: ruim, ok, ruim não alerta (não são 2 seguidas) -------------------------------
total=0
echo 85 > "$BASE/uso-_dados"; roda; total=$((total + $(emails)))
echo 40 > "$BASE/uso-_dados"; roda; total=$((total + $(emails)))
echo 85 > "$BASE/uso-_dados"; roda; total=$((total + $(emails)))
[ "$total" = 0 ]; verifica "ruim, ok, ruim: não alerta (não foram 2 seguidas)" $?
echo 40 > "$BASE/uso-_dados"; roda

# --- memória, container, backup e certificado -----------------------------------------------
alerta_em_2() { # alerta_em_2 <descrição> <palavra do assunto>
  roda; roda; { [ "$(emails)" = 1 ] && assunto | grep -q "$2"; }; verifica "$1" $?
}
printf 'teste-db-1 30.00%%\nteste-app-app-1 95.00%%\n' > "$BASE/memoria"
alerta_em_2 "memória de um container a 95% do limite: alerta" "memoria"
printf 'teste-db-1 30.00%%\nteste-app-app-1 50.00%%\n' > "$BASE/memoria"; roda

printf 'teste-db-1 Up 2 hours (unhealthy)\nteste-app-app-1 Up 2 hours\n' > "$BASE/containers"
alerta_em_2 "container unhealthy: alerta" "container"
printf 'teste-db-1 Up 2 hours (healthy)\nteste-app-app-1 Restarting (1) 5 seconds ago\n' > "$BASE/containers"
roda; grep -q 'teste-app-app-1' "$BASE/vigia.log"; verifica "container reiniciando entra no registro com o nome" $?
printf 'teste-db-1 Up 2 hours (healthy)\nteste-app-app-1 Up 2 hours\n' > "$BASE/containers"; roda

touch -t 202001010000 "$BASE/backups/diario/postgres-1.dump.age"
alerta_em_2 "backup mais novo com mais de 26 h: alerta" "backup"
touch "$BASE/backups/diario/postgres-1.dump.age"; roda

rm -f "$BASE/cert-ok"
alerta_em_2 "certificado a menos de 15 dias: alerta" "certificado"
touch "$BASE/cert-ok"; roda

# --- não conseguir medir também é problema ----------------------------------------------------
export STUB_DOCKER_FORA=1
alerta_em_2 "Docker fora do ar: alerta (não medir não é 'tudo ok')" "docker"
unset STUB_DOCKER_FORA; roda

# --- a senha do SMTP não vai para argumento nem para log --------------------------------------
grep -q 'senha-do-relay-de-teste' "$BASE/curl-args"; r=$?; [ "$r" != 0 ]; verifica "a senha do SMTP não vai em argumento do curl" $?
grep -q 'senha-do-relay-de-teste' "$BASE/curl-config"; verifica "ela vai por arquivo de configuração temporário (-K)" $?
grep -q 'senha-do-relay-de-teste' "$BASE/vigia.log"; r=$?; [ "$r" != 0 ]; verifica "e não aparece no registro" $?
{ grep -q 'smtp://relay.exemplo.org:587' "$BASE/curl-args" && grep -q -- '--ssl-reqd' "$BASE/curl-args"; }; verifica "porta 587: smtp:// com STARTTLS obrigatório" $?
{ grep -q -- '--mail-from alertas@exemplo.org' "$BASE/curl-args" && grep -q -- '--mail-rcpt mantenedor@exemplo.org' "$BASE/curl-args"; }; verifica "remetente e destinatário da configuração" $?
ls "$BASE/estado" | grep -qv '^[a-z0-9_.-]*$'; r=$?; [ "$r" != 0 ]; verifica "arquivos de estado com nome seguro" $?

# --- sem ALERTA_PARA: só registra (para instalar antes do remetente existir) ------------------
: > "$BASE/curl-args"; echo 90 > "$BASE/uso-_"
export ALERTA_PARA=; roda; roda
{ [ ! -s "$BASE/curl-args" ] && grep -q 'ALERTA.*disco' "$BASE/vigia.log"; }; verifica "sem ALERTA_PARA: não chama o SMTP, mas registra o alerta" $?
echo 40 > "$BASE/uso-_"; roda

# --- o cenário que o vigia existe para pegar: DISCO CHEIO (revisão do #361) --------------------
export ALERTA_PARA=mantenedor@exemplo.org
mkdir -p "$BASE/run" "$BASE/tmp-cheio" "$BASE/log-cheio"
export RUNTIME_DIRECTORY="$BASE/run"
# Estado vazio: é o que sobra de uma gravação truncada pelo disco cheio. Não pode abortar.
for f in "$BASE"/estado/*; do : > "$f"; done
roda; { [ "$RC" = 0 ] && [ "$(emails)" = 0 ]; }; verifica "estado vazio (gravação truncada): não aborta e segue" $?
# Disco cheio de verdade: nada grava no estado, no log nem no TMPDIR.
echo 100 > "$BASE/uso-_"
chmod 500 "$BASE/estado" "$BASE/tmp-cheio"; chmod 500 "$BASE/log-cheio"
REGISTRO_ORIGINAL=$REGISTRO; export REGISTRO="$BASE/log-cheio/vigia.log" TMPDIR="$BASE/tmp-cheio"
: > "$BASE/curl-config"; : > "$BASE/curl-args"
roda
{ [ "$(emails)" -ge 1 ] && grep -q 'ALERTA.*disco' "$BASE/emails"; }; verifica "disco cheio, estado sem escrita: alerta JÁ na 1ª medição" $?
grep -q '100%' "$BASE/emails"; verifica "e o e-mail diz o uso" $?
{ grep -q 'senha-do-relay-de-teste' "$BASE/curl-config" && grep -q -- "-K $BASE/run/" "$BASE/curl-args"; }; verifica "a senha vai pelo RUNTIME_DIRECTORY (/run), não pelo TMPDIR cheio" $?
[ -z "$(ls -A "$BASE/run")" ]; verifica "e o arquivo da senha some no fim" $?
grep -q 'disco' "$BASE/saida"; verifica "sem log gravável, a medição sai na saída (journal do systemd)" $?
# Liberado o espaço, volta a funcionar sozinho.
chmod 700 "$BASE/estado" "$BASE/tmp-cheio" "$BASE/log-cheio"; export REGISTRO=$REGISTRO_ORIGINAL TMPDIR=/tmp
echo 40 > "$BASE/uso-_"
roda; roda; { [ "$RC" = 0 ] && [ -s "$BASE/estado/disco__" ]; }; verifica "espaço liberado: volta a gravar o estado e não aborta" $?

# --- df com uso não numérico não aborta: vira "não consegui medir" ---------------------------
printf -- '-\n' > "$BASE/uso-_dados"
roda; roda; { [ "$RC" = 0 ] && grep -q 'ALERTA.*disco /dados' "$REGISTRO"; }; verifica "df com uso '-': não aborta e alerta que não mediu" $?
echo 40 > "$BASE/uso-_dados"; roda

# --- configuração faltando: sai 2 -----------------------------------------------------------
( unset AMBIENTE; bash "$SCRIPT" > /dev/null 2>&1; [ $? = 2 ] ); verifica "sem AMBIENTE: sai 2" $?

# --- comentário no fim da linha (#371): o EnvironmentFile do systemd o deixa no valor -----------
# Lê o .conf como o systemd lê (KEY=valor, o valor inteiro depois do "=", sem os espaços do começo).
conf_como_systemd() {
  local linha chave valor
  while IFS= read -r linha; do
    case "$linha" in ''|'#'*) continue ;; esac
    chave=${linha%%=*}; valor=${linha#*=}; valor=${valor#"${valor%%[![:space:]]*}"}
    printf '%s\0%s\0' "$chave" "$valor"
  done < "$1"
}
roda_com_conf() { # roda_com_conf <arquivo .conf>: o vigia só com o que o arquivo define
  local -a env=(); local k v
  while IFS= read -r -d '' k && IFS= read -r -d '' v; do env+=("$k=$v"); done < <(conf_como_systemd "$1")
  env -i PATH="$PATH" STUB="$STUB" "${env[@]}" bash "$SCRIPT" > "$BASE/saida-conf" 2>&1; RC=$?
}
printf 'AMBIENTE=teste\nESTADO_DIR=%s\nREGISTRO=%s\nALERTA_DE=                 # o remetente\nALERTA_PARA=               # vazio: só registra\n' \
  "$BASE/estado" "$BASE/vigia.log" > "$BASE/com-comentario.conf"
: > "$BASE/emails"
roda_com_conf "$BASE/com-comentario.conf"
{ [ "$RC" = 2 ] && grep -q 'ALERTA_DE ALERTA_PARA' "$BASE/saida-conf" && [ ! -s "$BASE/emails" ]; }
verifica "comentário no fim da linha do .conf: sai 2, nomeia ALERTA_DE e ALERTA_PARA, não envia" $?
printf 'AMBIENTE=teste\nESTADO_DIR=%s\nREGISTRO=%s\nCERT_HOST=site.exemplo.org outro\n' "$BASE/estado" "$BASE/vigia.log" > "$BASE/com-espaco.conf"
roda_com_conf "$BASE/com-espaco.conf"; { [ "$RC" = 2 ] && grep -q 'CERT_HOST' "$BASE/saida-conf"; }
verifica "valor único com espaço: sai 2" $?
printf '# comentário em linha própria\nAMBIENTE=teste\nESTADO_DIR=%s\nREGISTRO=%s\nDISCOS=/ /dados\nALERTA_PARA=\n' "$BASE/estado" "$BASE/vigia.log" > "$BASE/limpo.conf"
roda_com_conf "$BASE/limpo.conf"; [ "$RC" = 0 ]; verifica "comentário em linha própria e DISCOS com espaço: roda" $?
# O modelo do docs/OPERACAO.md não pode ter comentário no fim de linha (é ele que se copia).
modelo=$(awk '/^# \/etc\/complexo42\/vigia-<ambiente>\.conf/{f=1;next} f&&/^```/{exit} f' "$AQUI/../docs/OPERACAO.md")
{ [ -n "$modelo" ] && ! printf '%s\n' "$modelo" | grep -E '^[A-Z_]+=.*#' ; } > /dev/null
verifica "modelo do .conf no OPERACAO.md sem comentário no fim da linha" $?

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
