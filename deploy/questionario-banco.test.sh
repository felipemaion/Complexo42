#!/usr/bin/env bash
# Teste do questionario-banco.sh (#319) com dublê de `docker`: sem banco e sem rede. Confere o que o
# script prova sozinho: versão lida do JSON, chave só por stdin (nunca em argumento nem na saída),
# psql como supabase_admin, uma transação, e recusa de entrada inválida ANTES de chamar o banco.
# O efeito no banco de verdade é conferido pelo job "Staging de mentira" do CI.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/questionario-banco.sh"
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
cat > "$STUB_SQL"
[ -n "${STUB_DB_FALHA:-}" ] && { echo "ERROR: falhou" >&2; exit 1; }
exit 0
DUBLE
chmod +x "$BASE/bin/docker"
export PATH="$BASE/bin:$PATH" STUB_CHAMADAS="$BASE/chamadas" STUB_SQL="$BASE/sql" DB_CONTAINER=db-teste

CHAVE=$(printf 'k%.0s' $(seq 1 32) | base64 | tr -d '\n')
printf '{"consentTermVersion": "termo-teste-2", "items": []}\n' > "$BASE/q.json"
printf 'SITE_URL=https://outra-linha.exemplo.org\nQUESTIONNAIRE_SIGNING_KEY=%s\n' "$CHAVE" > "$BASE/segredos"

roda() { : > "$STUB_CHAMADAS"; : > "$STUB_SQL"; SAIDA=$("$SCRIPT" "$@" 2>&1); RC=$?; }

# --- caminho feliz -------------------------------------------------------------------------
roda "$BASE/q.json" "$BASE/segredos"
[ "$RC" = 0 ]; verifica "sai 0 no caminho feliz" $?
grep -q 'exec -i db-teste psql .*-U supabase_admin' "$STUB_CHAMADAS"; verifica "psql no container do banco como supabase_admin" $?
grep -q 'ON_ERROR_STOP=1' "$STUB_CHAMADAS"; verifica "psql com ON_ERROR_STOP" $?
grep -q "questionnaire_term_versions (version) values ('termo-teste-2') on conflict do nothing" "$STUB_SQL"; verifica "a versão vem do consentTermVersion do JSON" $?
grep -q "'questionnaire_signing_key', '$CHAVE'" "$STUB_SQL"; verifica "a chave vem do arquivo de segredos, por stdin" $?
grep -q 'on conflict (name) do update' "$STUB_SQL"; verifica "a chave é upsert (rodar de novo rotaciona ou não muda nada)" $?
{ head -n1 "$STUB_SQL" | grep -q '^begin;' && grep -q '^commit;' "$STUB_SQL"; }; verifica "as duas gravações numa transação" $?
grep -qF "$CHAVE" "$STUB_CHAMADAS"; r=$?; [ "$r" != 0 ]; verifica "nenhum argumento de docker leva a chave" $?
printf '%s' "$SAIDA" | grep -qF "$CHAVE"; r=$?; [ "$r" != 0 ]; verifica "a saída não imprime a chave" $?
grep -q 'outra-linha' "$STUB_SQL"; r=$?; [ "$r" != 0 ]; verifica "só a QUESTIONNAIRE_SIGNING_KEY sai do arquivo de segredos" $?

# --- o banco recusa ------------------------------------------------------------------------
STUB_DB_FALHA=1 roda "$BASE/q.json" "$BASE/segredos"
[ "$RC" = 1 ]; verifica "banco recusou: sai 1" $?

# --- entradas inválidas: nada chega ao banco -----------------------------------------------
recusa() { # recusa <descrição> <args...>
  local desc=$1; shift; roda "$@"
  { [ "$RC" = 2 ] && [ ! -s "$STUB_CHAMADAS" ]; }; verifica "$desc: sai 2 sem chamar o banco" $?
}
recusa "sem argumentos"
printf '{"items": []}\n' > "$BASE/sem-versao.json"
recusa "JSON sem consentTermVersion" "$BASE/sem-versao.json" "$BASE/segredos"
printf "{\"consentTermVersion\": \"x'); drop table y; --\"}\n" > "$BASE/injecao.json"
recusa "versão fora do formato (apóstrofo)" "$BASE/injecao.json" "$BASE/segredos"
printf 'QUESTIONNAIRE_SIGNING_KEY=curta\n' > "$BASE/curta"
recusa "chave curta" "$BASE/q.json" "$BASE/curta"
printf 'QUESTIONNAIRE_SIGNING_KEY=\n' > "$BASE/vazia"
recusa "chave vazia" "$BASE/q.json" "$BASE/vazia"
recusa "arquivo de segredos inexistente" "$BASE/q.json" "$BASE/nao-existe"
( unset DB_CONTAINER; roda "$BASE/q.json" "$BASE/segredos"; [ "$RC" = 2 ] ); verifica "sem DB_CONTAINER: sai 2" $?

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
