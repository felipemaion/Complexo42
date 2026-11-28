#!/usr/bin/env bash
# Teste do criar-conta.sh (#332). O dublê de `docker` não finge o container: ele roda o MESMO
# `node -e` do script, aqui, contra um Auth falso (um servidor http de 20 linhas). Assim o teste
# prova o código que vai ao container: o que sai por stdin, o pedido ao /admin/users e cada resposta.
# Precisa de `node` (o runner do CI tem; no servidor quem roda o node é o container do app).
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd); SCRIPT="$AQUI/criar-conta.sh"
acertos=0; falhas=0
verifica() {
  if [ "$2" = 0 ]; then acertos=$((acertos+1)); printf '  ok     %s\n' "$1"
  else falhas=$((falhas+1)); printf '  FALHA  %s\n' "$1"; fi
}
command -v node > /dev/null || { echo "sem node -- teste PULADO"; exit 0; }

BASE=$(mktemp -d)
PID=
limpar() { [ -n "$PID" ] && kill "$PID" 2> /dev/null; rm -rf -- "$BASE"; return 0; }
trap limpar EXIT
mkdir -p "$BASE/bin"

# Auth falso: grava o que recebeu e responde conforme o arquivo $BASE/resposta ("<status> <corpo>").
cat > "$BASE/auth.mjs" << 'JS'
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const base = process.argv[2];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    writeFileSync(`${base}/pedido.json`, JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    const [status, ...rest] = readFileSync(`${base}/resposta`, "utf8").trim().split(" ");
    res.writeHead(Number(status), { "content-type": "application/json" });
    res.end(rest.join(" "));
  });
});
server.listen(0, "127.0.0.1", () => writeFileSync(`${base}/porta`, String(server.address().port)));
JS
node "$BASE/auth.mjs" "$BASE" & PID=$!
for _ in $(seq 1 50); do [ -s "$BASE/porta" ] && break; sleep 0.1; done
[ -s "$BASE/porta" ] || { echo "o Auth falso não subiu"; exit 1; }

# Dublê de docker: registra a linha de comando e roda o `node ...` localmente, com o SUPABASE_URL
# que o container do app teria (aqui, o Auth falso).
cat > "$BASE/bin/docker" << 'DUBLE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_CHAMADAS"
[ "$1" = exec ] || exit 0
shift; [ "$1" = -i ] && shift; shift   # tira "-i <container>"
SUPABASE_URL="$STUB_SUPABASE_URL" exec "$@"
DUBLE
chmod +x "$BASE/bin/docker"
export PATH="$BASE/bin:$PATH" STUB_CHAMADAS="$BASE/chamadas" STUB_SUPABASE_URL="http://127.0.0.1:$(cat "$BASE/porta")"
export APP_CONTAINER=app-teste

CHAVE="eyJhbGciOiJIUzI1NiJ9.$(printf %s '{"role":"service_role"}' | base64 | tr -d '=\n').assinatura-de-teste"
printf 'SITE_URL=https://outra-linha.exemplo.org\nSERVICE_ROLE_KEY=%s\n' "$CHAVE" > "$BASE/segredos"

roda() { # roda <e-mail> <args...>
  : > "$STUB_CHAMADAS"; rm -f "$BASE/pedido.json"
  SAIDA=$(printf '%s\n' "$1" | "$SCRIPT" "${@:2}" 2>&1); RC=$?
}
campo() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(eval("p."+process.argv[2]))' "$BASE/pedido.json" "$1" 2> /dev/null; }

# --- caminho feliz ------------------------------------------------------------------------
echo '200 {"id":"00000000-0000-0000-0000-000000000001"}' > "$BASE/resposta"
roda "Ana.Teste@Exemplo.org" "$BASE/segredos"
[ "$RC" = 0 ]; verifica "conta criada: sai 0" $?
printf '%s' "$SAIDA" | grep -q 'Conta criada'; verifica "diz que criou" $?
[ "$(campo method) $(campo url)" = "POST /auth/v1/admin/users" ]; verifica "POST no /auth/v1/admin/users do SUPABASE_URL do app" $?
[ "$(campo 'headers.apikey')" = "$CHAVE" ]; verifica "a chave de serviço vai no apikey" $?
[ "$(campo 'headers.authorization')" = "Bearer $CHAVE" ]; verifica "e no Authorization" $?
[ "$(campo 'body')" = '{"email":"ana.teste@exemplo.org","email_confirm":true}' ]; verifica "corpo: e-mail normalizado e confirmado (o link mágico funciona de primeira)" $?
grep -q 'exec -i app-teste node --input-type=module -e' "$STUB_CHAMADAS"; verifica "o pedido sai do container do app (rede interna)" $?
grep -qF "$CHAVE" "$STUB_CHAMADAS"; r=$?; [ "$r" != 0 ]; verifica "nenhum argumento de docker leva a chave" $?
grep -qi 'ana.teste\|exemplo\.org' "$STUB_CHAMADAS"; r=$?; [ "$r" != 0 ]; verifica "nenhum argumento de docker leva o e-mail" $?
printf '%s' "$SAIDA" | grep -qF "$CHAVE"; r=$?; [ "$r" != 0 ]; verifica "a saída não imprime a chave" $?
printf '%s' "$SAIDA" | grep -q '@'; r=$?; [ "$r" != 0 ]; verifica "a saída não repete o e-mail" $?

# --- conta já existe: idempotente -----------------------------------------------------------
echo '422 {"code":422,"error_code":"email_exists","msg":"A user with this email address has already been registered"}' > "$BASE/resposta"
roda "ana@exemplo.org" "$BASE/segredos"
{ [ "$RC" = 0 ] && printf '%s' "$SAIDA" | grep -q 'já existia'; }; verifica "conta já existente: sai 0 e diz que já existia" $?

# --- o Auth recusa --------------------------------------------------------------------------
echo '401 {"msg":"invalid JWT"}' > "$BASE/resposta"
roda "ana@exemplo.org" "$BASE/segredos"
[ "$RC" = 1 ]; verifica "Auth recusou (chave errada): sai 1" $?
printf '%s' "$SAIDA" | grep -q '401'; verifica "e diz o status, sem o corpo" $?
printf '%s' "$SAIDA" | grep -q 'invalid JWT'; r=$?; [ "$r" != 0 ]; verifica "o corpo da resposta não vai para a saída" $?

# --- entradas inválidas: nada chega ao container ---------------------------------------------
recusa() { # recusa <descrição> <e-mail> <args...>
  local desc=$1; shift; roda "$@"
  { [ "$RC" = 2 ] && [ ! -s "$STUB_CHAMADAS" ]; }; verifica "$desc: sai 2 sem chamar o container" $?
}
recusa "e-mail inválido" "sem-arroba" "$BASE/segredos"
recusa "e-mail com apóstrofo" "ana'@exemplo.org" "$BASE/segredos"
recusa "sem arquivo de segredos" "ana@exemplo.org"
recusa "arquivo de segredos inexistente" "ana@exemplo.org" "$BASE/nao-existe"
printf 'SERVICE_ROLE_KEY=\n' > "$BASE/vazia"
recusa "chave vazia" "ana@exemplo.org" "$BASE/vazia"
printf 'SERVICE_ROLE_KEY=%s\n' "eyJhbGciOiJIUzI1NiJ9.$(printf %s '{"role":"anon"}' | base64 | tr -d '=\n').x" > "$BASE/anon"
recusa "chave anon no lugar da de serviço" "ana@exemplo.org" "$BASE/anon"
( unset APP_CONTAINER; roda "ana@exemplo.org" "$BASE/segredos"; [ "$RC" = 2 ] ); verifica "sem APP_CONTAINER: sai 2" $?

printf '\n%s acertos, %s falhas\n' "$acertos" "$falhas"
[ "$falhas" = 0 ]
