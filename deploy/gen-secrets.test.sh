#!/usr/bin/env bash
# Teste do gen-secrets.sh (R2). Roda em diretório temporário.
# NENHUM valor de segredo é impresso: as asserções olham tamanho e forma.
set -uo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
FALHAS=0

ok()   { printf "  ok   %s\n" "$1"; }
falha(){ printf "  FALHA %s\n" "$1"; FALHAS=$((FALHAS+1)); }
checa(){ if [ "$2" = "$3" ]; then ok "$1"; else falha "$1 (esperado $3, obtido $2)"; fi; }

ENVF="$TMPD/env"
"$AQUI/gen-secrets.sh" "$ENVF" "https://exemplo.invalid" "ambtest" > /dev/null || { falha "geracao"; exit 1; }
ok "gerou o arquivo"

checa "modo 0600" "$(stat -c %a "$ENVF" 2>/dev/null || stat -f %Lp "$ENVF")" "600"

for k in COMPOSE_PROJECT_NAME KONG_ALIAS POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY \
         FIELD_ENCRYPTION_KEY BLIND_INDEX_KEY SITE_URL URI_ALLOW_LIST; do
  grep -q "^$k=." "$ENVF" && ok "$k presente e nao vazio" || falha "$k ausente ou vazio"
done

val(){ grep -m1 "^$1=" "$ENVF" | cut -d= -f2-; }
P=$(val POSTGRES_PASSWORD); checa "POSTGRES_PASSWORD 40 chars" "${#P}" "40"
J=$(val JWT_SECRET);        checa "JWT_SECRET 64 chars"        "${#J}" "64"
F=$(val FIELD_ENCRYPTION_KEY); checa "FIELD_ENCRYPTION_KEY 32 bytes em base64" "${#F}" "44"
B=$(val BLIND_INDEX_KEY);      checa "BLIND_INDEX_KEY 32 bytes em base64"      "${#B}" "44"

[ "$F" != "$B" ] && ok "as duas chaves do ADR 0003 sao diferentes" \
                 || falha "FIELD_ENCRYPTION_KEY e BLIND_INDEX_KEY iguais"

case "$P" in *[!A-Za-z0-9]*) falha "senha do Postgres tem char que quebra URI";; *) ok "senha do Postgres segura em URI";; esac

# Os dois JWT precisam conferir com o JWT_SECRET e trazer o papel certo.
for par in "ANON_KEY:anon" "SERVICE_ROLE_KEY:service_role"; do
  k=${par%%:*}; papel=${par##*:}
  TOKEN=$(val "$k") SEGREDO="$J" PAPEL="$papel" python3 - <<'PY' && ok "$k assinado e com papel correto" || falha "$k invalido"
import base64, hmac, hashlib, json, os, sys
def pad(s): return s + "=" * (-len(s) % 4)
tok = os.environ["TOKEN"]; seg = os.environ["SEGREDO"].encode()
h, p, s = tok.split(".")
esperada = base64.urlsafe_b64encode(
    hmac.new(seg, (h + "." + p).encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
if not hmac.compare_digest(s, esperada): sys.exit("assinatura nao confere")
dados = json.loads(base64.urlsafe_b64decode(pad(p)))
if dados.get("role") != os.environ["PAPEL"]: sys.exit("papel errado")
if dados.get("exp", 0) <= dados.get("iat", 0): sys.exit("exp invalido")
PY
done

# Nao sobrescreve sem --force.
if "$AQUI/gen-secrets.sh" "$ENVF" "https://exemplo.invalid" "ambtest" > /dev/null 2>&1; then
  falha "sobrescreveu arquivo existente sem --force"
else
  ok "recusa sobrescrever sem --force"
fi

# Duas geracoes nao repetem segredo.
"$AQUI/gen-secrets.sh" "$TMPD/env2" "https://exemplo.invalid" "ambtest" > /dev/null
[ "$(val JWT_SECRET)" != "$(grep -m1 '^JWT_SECRET=' "$TMPD/env2" | cut -d= -f2-)" ] \
  && ok "duas geracoes produzem segredos distintos" || falha "segredo repetido entre geracoes"

echo
[ "$FALHAS" -eq 0 ] && { echo "TODOS OS TESTES PASSARAM"; exit 0; } || { echo "$FALHAS teste(s) falharam"; exit 1; }
