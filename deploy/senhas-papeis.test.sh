#!/usr/bin/env bash
# Teste do senhas-papeis.sh (#95) com um dublê de docker que guarda o "banco" em arquivos: senha e
# login de cada papel e o ambiente dos containers. Sem Docker e sem rede. Confere o --conferir (sem
# imprimir senha), o --aplicar e o --rotacionar: arquivo reescrito só na linha certa, senha nova fora
# dos argumentos de processo e, quando a saúde não volta, arquivo E banco devolvidos.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/senhas-papeis.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT
mkdir -p "$BASE/bin" "$BASE/segredos"
cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB/argv"
if [ "$1" = inspect ]; then
  fmt=$3; cid=$4
  case "$fmt" in
    *Config.Env*) cat "$STUB/env-${cid#cid-}" 2> /dev/null ;;
    *State.Status*) echo running ;;
  esac
  exit 0
fi
[ "$1" = compose ] || exit 1
while [ "$1" != -f ]; do shift; done; shift 2
case "$1" in
  ps) [ -f "$STUB/parado-$3" ] || echo "cid-$3" ;;
  up|restart) echo "$*" >> "$STUB/recriados" ;;
  exec)
    if [ "$4" = psql ]; then
      entrada=$(cat)
      if grep -q 'from pg_authid' <<< "$entrada"; then
        for p in authenticator postgres supabase_auth_admin; do
          tem=f; [ -s "$STUB/pw-$p" ] && tem=t
          echo "$p|$(cat "$STUB/login-$p")|$tem"
        done
        exit 0
      fi
      s=$(sed -n "s/^\\\\set s '\\(.*\\)'$/\\1/p" <<< "$entrada")
      papel=$(sed -n 's/^alter role \([a-z_]*\) with login password.*/\1/p' <<< "$entrada")
      if [ -n "$papel" ]; then printf '%s' "$s" > "$STUB/pw-$papel"; echo t > "$STUB/login-$papel"; fi
      if grep -q 'alter role postgres with nologin password null' <<< "$entrada"; then echo f > "$STUB/login-postgres"; : > "$STUB/pw-postgres"; fi
      exit 0
    fi
    # login por TCP: a senha chega no stdin; o papel é o último argumento
    IFS= read -r senha; papel=${!#}
    if [ "$(cat "$STUB/login-$papel")" = t ] && [ "$senha" = "$(cat "$STUB/pw-$papel")" ]; then echo 1; else exit 2; fi ;;
esac
DUBLE
chmod +x "$BASE/bin/docker"
export PATH="$BASE/bin:$PATH" STUB="$BASE"
export COMPOSE_FILE="$BASE/compose.yml" ENV_FILE="$BASE/segredos/env" SUPABASE_PROJETO=teste ESPERA_SAUDE=2 ESPERA_PASSO=0
SUPER=SuperusuarioDeTeste0000000000000000000000; AUT=AutenticadorDeTeste000000000000000000000; ADM=AdminDoAuthDeTeste0000000000000000000000

inicio() { # banco e arquivo no estado certo
  rm -f "$BASE"/segredos/*
  printf 'COMPOSE_PROJECT_NAME=teste\nPOSTGRES_PASSWORD=%s\nAUTHENTICATOR_PASSWORD=%s\nAUTH_ADMIN_PASSWORD=%s\nSITE_URL=https://x.exemplo.org\n' \
    "$SUPER" "$AUT" "$ADM" > "$ENV_FILE"; chmod 600 "$ENV_FILE"
  printf '%s' "$AUT" > "$BASE/pw-authenticator"; echo t > "$BASE/login-authenticator"
  printf '%s' "$ADM" > "$BASE/pw-supabase_auth_admin"; echo t > "$BASE/login-supabase_auth_admin"
  : > "$BASE/pw-postgres"; echo f > "$BASE/login-postgres"
  printf 'PGRST_DB_URI=postgres://authenticator:%s@db:5432/postgres\n' "$AUT" > "$BASE/env-rest"
  printf 'GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:%s@db:5432/postgres\n' "$ADM" > "$BASE/env-auth"
  rm -f "$BASE/argv" "$BASE/recriados"
}
troca_no_arquivo() { # troca_no_arquivo <chave> <valor>, sem deixar arquivo de backup do sed
  awk -v k="$1" -v v="$2" 'index($0, k "=") == 1 { print k "=" v; next } { print }' "$ENV_FILE" > "$BASE/novo" && cat "$BASE/novo" > "$ENV_FILE"
}
roda() { bash "$SCRIPT" "$@" > "$BASE/saida" 2>&1; RC=$?; }
sem_senha_na_saida() { ! grep -qE "$SUPER|$AUT|$ADM" "$BASE/saida"; }

inicio; roda --conferir
{ [ "$RC" = 0 ] && ! grep -q FALHA "$BASE/saida" && sem_senha_na_saida; }; verifica "conferir no estado certo: tudo ok, nenhuma senha impressa" $?

inicio; echo t > "$BASE/login-postgres"; printf '%s' "$SUPER" > "$BASE/pw-postgres"; roda --conferir
{ [ "$RC" = 1 ] && grep -q 'FALHA: papel postgres' "$BASE/saida" && sem_senha_na_saida; }; verifica "postgres com login (volume antigo): conferir reprova" $?

inicio; printf '%s' "$SUPER" > "$BASE/pw-authenticator"; roda --conferir
{ [ "$RC" = 1 ] && grep -q 'superusuário entra num papel de serviço' "$BASE/saida"; }; verifica "papel de serviço com a senha do superusuário: reprova" $?

inicio; printf 'POSTGRES_PASSWORD=%s\n' "$SUPER" >> "$BASE/env-rest"; roda --conferir
{ [ "$RC" = 1 ] && grep -q 'container rest recebe a senha do superusuário' "$BASE/saida" && sem_senha_na_saida; }; verifica "rest com a senha do superusuário no ambiente: reprova sem imprimi-la" $?

inicio; troca_no_arquivo AUTH_ADMIN_PASSWORD "$AUT"; roda --conferir
{ [ "$RC" = 1 ] && grep -q 'senhas repetidas' "$BASE/saida"; }; verifica "duas senhas iguais no arquivo: reprova" $?

inicio; echo t > "$BASE/login-postgres"; printf '%s' "$SUPER" > "$BASE/pw-postgres"; printf 'velha' > "$BASE/pw-authenticator"
roda --aplicar
{ [ "$RC" = 0 ] && [ "$(cat "$BASE/login-postgres")" = f ] && [ "$(cat "$BASE/pw-authenticator")" = "$AUT" ] \
  && grep -q 'restart rest auth' "$BASE/recriados" && ! grep -qE "$AUT|$ADM" "$BASE/argv"; }
verifica "aplicar: senhas do arquivo no banco, postgres sem login, rest e auth reiniciados, nada em argumento" $?

# --- rotação que dá certo ---------------------------------------------------------------------
inicio; cp "$ENV_FILE" "$BASE/antes"; roda --rotacionar AUTHENTICATOR_PASSWORD
nova=$(sed -n 's/^AUTHENTICATOR_PASSWORD=//p' "$ENV_FILE")
{ [ "$RC" = 0 ] && [ "${#nova}" = 40 ] && [ "$nova" != "$AUT" ] && [ "$(cat "$BASE/pw-authenticator")" = "$nova" ] \
  && cmp -s <(grep -v '^AUTHENTICATOR_PASSWORD=' "$BASE/antes") <(grep -v '^AUTHENTICATOR_PASSWORD=' "$ENV_FILE"); }
verifica "rotacionar: senha nova no arquivo e no banco, o resto do arquivo intacto" $?
{ ! grep -qF "$nova" "$BASE/argv" && ! grep -qF "$nova" "$BASE/saida"; }; verifica "rotacionar: a senha nova não aparece em argumento nem na saída" $?
{ grep -q 'force-recreate rest' "$BASE/recriados" && ! grep -q 'auth' "$BASE/recriados"; }; verifica "rotacionar: recria só o rest" $?
{ [ "$(ls -A "$BASE/segredos")" = env ] && [ "$(stat -c %a "$ENV_FILE" 2> /dev/null || stat -f %Lp "$ENV_FILE")" = 600 ]; }
verifica "rotacionar: sem temporário nem backup sobrando; arquivo segue 600" $?

# --- rotação em que a saúde não volta: arquivo E banco voltam --------------------------------
inicio; cp "$ENV_FILE" "$BASE/antes"; printf '%s' "$AUT" > "$BASE/original"
SAUDE_CMD='cmp -s "$STUB/pw-authenticator" "$STUB/original"' roda --rotacionar AUTHENTICATOR_PASSWORD
{ [ "$RC" = 1 ] && cmp -s "$ENV_FILE" "$BASE/antes" && [ "$(cat "$BASE/pw-authenticator")" = "$AUT" ] \
  && grep -q 'voltou ao estado anterior' "$BASE/saida" && [ "$(ls -A "$BASE/segredos")" = env ]; }
verifica "saúde não volta: arquivo idêntico ao de antes e a senha antiga de volta no banco" $?

# --- recusas: nada muda ----------------------------------------------------------------------
inicio; cp "$ENV_FILE" "$BASE/antes"; roda --rotacionar POSTGRES_PASSWORD
{ [ "$RC" = 2 ] && cmp -s "$ENV_FILE" "$BASE/antes"; }; verifica "rotacionar a do superusuário: recusa (passo manual) e não mexe no arquivo" $?
inicio; printf 'AUTHENTICATOR_PASSWORD=%s\n' "$ADM" >> "$ENV_FILE"; cp "$ENV_FILE" "$BASE/antes"; roda --rotacionar AUTHENTICATOR_PASSWORD
{ [ "$RC" != 0 ] && cmp -s "$ENV_FILE" "$BASE/antes" && [ "$(cat "$BASE/pw-authenticator")" = "$AUT" ]; }
verifica "chave repetida no arquivo: recusa sem mexer no arquivo nem no banco" $?

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
