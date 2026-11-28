#!/usr/bin/env bash
# Teste do bootstrap-coordenacao.sh (#295) com dublê de `docker`: sem banco e sem rede.
# Confere o que o script prova sozinho: e-mail só por stdin (nunca em argumento), HMAC pedido ao
# container do app, SQL chamado como supabase_admin, mensagens sem e-mail e códigos de saída.
# A função SQL em si é testada em supabase/tests/bootstrap_root_manager.test.sql.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/bootstrap-coordenacao.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}

BASE=$(mktemp -d); trap 'rm -rf -- "$BASE"' EXIT
mkdir -p "$BASE/bin"
cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CHAMADAS"
[ "$1" = exec ] || exit 0
case "$*" in
  *email-hmac.mjs*)
    cat > "$STUB_EMAIL_VISTO"
    [ -n "${STUB_APP_FALHA:-}" ] && exit 1
    printf '%s\n' "${STUB_HMAC:-$(printf 'a%.0s' $(seq 64))}"; exit 0 ;;
  *psql*)
    cat > "$STUB_SQL"
    [ -n "${STUB_DB_FALHA:-}" ] && { echo "ERROR: falhou" >&2; exit 1; }
    if [ -n "${STUB_JSON:-}" ]; then printf '%s\n' "$STUB_JSON"
    else printf '%s\n' '{"allowlisted": true, "promoted": 0, "role": "waiting_profile"}'; fi
    exit 0 ;;
esac
exit 0
DUBLE
chmod +x "$BASE/bin/docker"
export PATH="$BASE/bin:$PATH" STUB_CHAMADAS="$BASE/chamadas" STUB_SQL="$BASE/sql" STUB_EMAIL_VISTO="$BASE/email-visto"
export APP_CONTAINER=app-teste DB_CONTAINER=db-teste

roda() { : > "$STUB_CHAMADAS"; : > "$STUB_SQL"; : > "$STUB_EMAIL_VISTO"; SAIDA=$(printf '%s\n' "$1" | "$SCRIPT" "${@:2}" 2>&1); RC=$?; }

# --- caminho feliz: e-mail só por stdin, SQL como supabase_admin -------------------------
roda "Ana.Teste@Exemplo.org"
[ "$RC" = 0 ]; verifica "sai 0 no caminho feliz" $?
grep -q 'ana.teste@exemplo.org' "$STUB_EMAIL_VISTO"; verifica "o container do app recebe o e-mail normalizado por stdin" $?
grep -q 'ana' "$STUB_CHAMADAS"; r=$?; [ "$r" != 0 ]; verifica "nenhum argumento de docker leva o e-mail" $?
grep -q '@' "$STUB_CHAMADAS"; r=$?; [ "$r" != 0 ]; verifica "nenhum argumento de docker leva arroba" $?
grep -q 'exec -i app-teste node deploy/email-hmac.mjs' "$STUB_CHAMADAS"; verifica "o HMAC é pedido ao container do app" $?
grep -q 'exec -i db-teste psql .*-U supabase_admin' "$STUB_CHAMADAS"; verifica "psql roda no container do banco como supabase_admin" $?
grep -q 'ON_ERROR_STOP=1' "$STUB_CHAMADAS"; verifica "psql com ON_ERROR_STOP" $?
grep -q "app.bootstrap_root_manager('$(printf 'a%.0s' $(seq 64))', 'ana.teste@exemplo.org', false)" "$STUB_SQL"; verifica "o SQL leva o HMAC, o e-mail e a flag false (por stdin)" $?
printf '%s' "$SAIDA" | grep -q '@'; r=$?; [ "$r" != 0 ]; verifica "a saída não repete o e-mail" $?
printf '%s' "$SAIDA" | grep -q 'rode o comando de novo'; verifica "sem perfil: manda a pessoa entrar e rodar de novo" $?

# --- flag explícita -----------------------------------------------------------------------
roda "ana@exemplo.org" --adicionar-outro
grep -q "'ana@exemplo.org', true)" "$STUB_SQL"; verifica "--adicionar-outro vira true" $?

# --- mensagens por resultado --------------------------------------------------------------
STUB_JSON='{"allowlisted": false, "promoted": 1, "role": "granted"}' roda "ana@exemplo.org"
{ [ "$RC" = 0 ] && printf '%s' "$SAIDA" | grep -q 'papel de gestor da raiz concedido'; }; verifica "granted: mensagem e saída 0" $?
STUB_JSON='{"allowlisted": false, "promoted": 0, "role": "already"}' roda "ana@exemplo.org"
{ [ "$RC" = 0 ] && printf '%s' "$SAIDA" | grep -q 'já era gestora'; }; verifica "already: neutro, saída 0" $?
STUB_JSON='{"allowlisted": false, "promoted": 0, "role": "not_active"}' roda "ana@exemplo.org"
[ "$RC" = 3 ]; verifica "not_active: saída 3" $?

# --- recusas antes de tocar em qualquer container -----------------------------------------
for ruim in "" "sem-arroba" "a b@exemplo.org" "a'b@exemplo.org" 'a";x@exemplo.org' "a@b"; do
  roda "$ruim"
  { [ "$RC" = 2 ] && [ ! -s "$STUB_CHAMADAS" ]; }; verifica "e-mail inválido (${#ruim} chars) recusado sem chamar docker" $?
done
roda "ana@exemplo.org" --qualquer
[ "$RC" = 2 ]; verifica "argumento desconhecido: saída 2" $?
( unset APP_CONTAINER; printf 'ana@exemplo.org\n' | "$SCRIPT" >/dev/null 2>&1 ); [ "$?" = 2 ]; verifica "sem APP_CONTAINER: saída 2" $?
( unset DB_CONTAINER; printf 'ana@exemplo.org\n' | "$SCRIPT" >/dev/null 2>&1 ); [ "$?" = 2 ]; verifica "sem DB_CONTAINER: saída 2" $?

# --- falhas a jusante falham fechado -------------------------------------------------------
STUB_APP_FALHA=1 roda "ana@exemplo.org"
{ [ "$RC" = 1 ] && [ ! -s "$STUB_SQL" ]; }; verifica "falha do HMAC: saída 1 e nada chega ao banco" $?
STUB_HMAC=curto roda "ana@exemplo.org"
{ [ "$RC" = 1 ] && [ ! -s "$STUB_SQL" ]; }; verifica "HMAC fora do formato: saída 1 e nada chega ao banco" $?
STUB_DB_FALHA=1 roda "ana@exemplo.org"
[ "$RC" = 1 ]; verifica "falha do banco: saída 1" $?
STUB_JSON='lixo' roda "ana@exemplo.org"
[ "$RC" = 1 ]; verifica "resposta inesperada do banco: saída 1" $?

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
