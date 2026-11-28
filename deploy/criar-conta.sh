#!/usr/bin/env bash
# Cria a conta de um e-mail no Auth com o cadastro FECHADO (issue #332). O compose do deploy liga
# GOTRUE_DISABLE_SIGNUP: quem não tem conta não entra, e o link mágico falha calado
# (`signup_disabled`) -- inclusive para a primeira coordenação, que o bootstrap manda "entrar uma
# vez". Este é o passo que faltava antes do deploy/bootstrap-coordenacao.sh (docs/OPERACAO.md).
#
# Uso (no servidor, como operador):
#   APP_CONTAINER=<container do app> deploy/criar-conta.sh <arquivo-de-segredos>
#   (digite o e-mail e Enter; ou: printf '%s\n' "$EMAIL" | deploy/criar-conta.sh <segredos>)
#
# - O pedido sai do container do APP, pela rede interna (SUPABASE_URL dele, o kong). De fora,
#   /auth/v1/admin dá 404 (#278); de dentro, sem X-Forwarded-For, passa.
# - A SERVICE_ROLE_KEY sai do arquivo de segredos e vai ao `node` do container SÓ por stdin, junto
#   com o e-mail: nada em argumento (`ps`), no ambiente do container, em log ou em disco. O app não
#   a recebe nunca (R6); ela existe só na memória desse processo, durante a chamada.
# - A conta nasce com o e-mail confirmado e SEM acesso: quem libera é a lista de autorizados
#   (bootstrap ou coordenação). Criar conta não autoriza ninguém.
# - Idempotente: conta que já existe não é erro.
# Saídas: 0 criada ou já existia, 1 o Auth recusou, 2 uso errado ou entrada inválida.
set -euo pipefail
umask 077

APP_CONTAINER=${APP_CONTAINER:-}
# Checagem explícita, e NÃO `: "${VAR:?}"` (ver a nota do deploy/migra.sh sobre `set -e` e `trap`).
[ -n "$APP_CONTAINER" ] || { echo "falta APP_CONTAINER (container do app)" >&2; exit 2; }
[ $# -eq 1 ] || { echo "uso: criar-conta.sh <arquivo-de-segredos>  (e-mail por stdin)" >&2; exit 2; }
SEGREDOS=$1
[ -r "$SEGREDOS" ] || { echo "não consigo ler o arquivo de segredos" >&2; exit 2; }

EMAIL=
IFS= read -r EMAIL || true
EMAIL=$(printf '%s' "$EMAIL" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
# Mesma forma estrita do bootstrap-coordenacao.sh.
printf '%s' "$EMAIL" | grep -Eq '^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$' || { echo "e-mail inválido" >&2; exit 2; }

KEY=$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$SEGREDOS" | head -n1)
# Tem de ser a de serviço: com a anon, o Auth recusaria, mas o erro chegaria tarde e confuso.
PAPEL=$(KEY="$KEY" python3 -c '
import base64, json, os
try:
    p = os.environ["KEY"].split(".")[1]
    print(json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))).get("role", ""))
except Exception:
    print("")' 2> /dev/null || true)
[ "$PAPEL" = service_role ] || { echo "SERVICE_ROLE_KEY ausente ou não é a chave de serviço no arquivo de segredos" >&2; exit 2; }

# Roda no container do app. Lê a chave e o e-mail do stdin; imprime só um código de resultado
# (nunca o corpo da resposta do Auth, que pode ecoar o e-mail).
CODIGO='
const partes = [];
for await (const parte of process.stdin) partes.push(parte);
const [key, email] = Buffer.concat(partes).toString("utf8").split("\n");
const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, email_confirm: true }),
});
if (res.ok) { console.log("criada"); process.exit(0); }
const corpo = await res.json().catch(() => ({}));
if (res.status === 422 && corpo.error_code === "email_exists") { console.log("existia"); process.exit(0); }
console.log(`status ${res.status}`);
process.exit(1);
'

# printf é builtin: a chave e o e-mail não aparecem na lista de processos.
if ! RESP=$(printf '%s\n%s\n' "$KEY" "$EMAIL" | docker exec -i "$APP_CONTAINER" node --input-type=module -e "$CODIGO" 2> /dev/null); then
  echo "o Auth recusou (${RESP:-sem resposta}); nenhuma conta criada" >&2; exit 1
fi
case "$RESP" in
  criada)  echo "OK: Conta criada (e-mail confirmado, sem acesso). Agora o bootstrap-coordenacao.sh, ou a coordenação, a autoriza." ;;
  existia) echo "OK: a conta já existia; nada mudou." ;;
  *)       echo "resposta inesperada do container do app" >&2; exit 1 ;;
esac
