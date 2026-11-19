#!/usr/bin/env bash
# Gera os segredos de UM ambiente, direto no arquivo de destino.
#
# Regras de ouro:
#  - nenhum valor é impresso na tela. O que você vê é só nome e tamanho.
#  - o arquivo nasce 0600 (umask 077), antes de receber conteúdo.
#  - não sobrescreve arquivo existente sem --force (chave perdida = dado
#    cifrado perdido, ADR 0003 §2).
#
# Uso: ./gen-secrets.sh <arquivo-destino> <site-url> [--force]
set -euo pipefail
umask 077

DEST=${1:?uso: gen-secrets.sh <arquivo-destino> <site-url> <nome-do-ambiente> [--force]}
SITE=${2:?falta a SITE_URL do ambiente}
AMB=${3:?falta o nome do ambiente (ex.: complexo42stg)}
FORCE=${4:-}

if [ -e "$DEST" ] && [ "$FORCE" != "--force" ]; then
  echo "ERRO: $DEST já existe. Use --force se tem certeza." >&2
  echo "      Trocar FIELD_ENCRYPTION_KEY torna ilegível todo dado já cifrado." >&2
  exit 2
fi

b64() { openssl rand -base64 "$1" | tr -d "\n"; }

# Alfanumérico via python3 (módulo `secrets`, CSPRNG). Deliberadamente SEM
# pipe: `tr -dc ... | head -c N` faz o head fechar o pipe, o tr morre com
# SIGPIPE e, com `set -o pipefail`, o script inteiro aborta na segunda chamada.
alnum() { python3 -c "import secrets,string,sys;print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(int(sys.argv[1]))))" "$1"; }

# Senha do Postgres sem caracteres especiais: ela entra em URI de conexão.
POSTGRES_PASSWORD=$(alnum 40)
JWT_SECRET=$(alnum 64)
FIELD_ENCRYPTION_KEY=$(b64 32)
BLIND_INDEX_KEY=$(b64 32)

# ANON_KEY e SERVICE_ROLE_KEY são JWT HS256 assinados com o JWT_SECRET.
# Python da biblioteca padrão, sem dependência nova (R9).
jwt() {
  JWT_SECRET="$JWT_SECRET" PAPEL="$1" python3 - <<'PY'
import base64, hmac, hashlib, json, os, time
def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b"=")
seg = os.environ["JWT_SECRET"].encode()
hdr = b64u(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
agora = int(time.time())
pay = b64u(json.dumps({"role":os.environ["PAPEL"],"iss":"supabase",
    "iat":agora,"exp":agora+60*60*24*365*5},separators=(",",":")).encode())
msg = hdr + b"." + pay
sig = b64u(hmac.new(seg, msg, hashlib.sha256).digest())
print((msg + b"." + sig).decode())
PY
}
ANON_KEY=$(jwt anon)
SERVICE_ROLE_KEY=$(jwt service_role)

TMP=$(mktemp "${DEST}.XXXXXX")
trap 'rm -f "$TMP"' EXIT
{
  echo "# Gerado por gen-secrets.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). NÃO versionar."
  echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
  echo "JWT_SECRET=$JWT_SECRET"
  echo "ANON_KEY=$ANON_KEY"
  echo "SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"
  echo "FIELD_ENCRYPTION_KEY=$FIELD_ENCRYPTION_KEY"
  echo "BLIND_INDEX_KEY=$BLIND_INDEX_KEY"
  echo "COMPOSE_PROJECT_NAME=$AMB"
  echo "KONG_ALIAS=$AMB-kong"
  echo "SITE_URL=$SITE"
  echo "URI_ALLOW_LIST=$SITE"
  echo "SMTP_HOST="
  echo "SMTP_PORT=587"
  echo "SMTP_USER="
  echo "SMTP_PASS="
  echo "SMTP_ADMIN_EMAIL="
} > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$DEST"
trap - EXIT

echo "ok: $DEST ($(stat -c %a "$DEST" 2>/dev/null || stat -f %Lp "$DEST") , $(grep -c "=" "$DEST") variáveis)"
# IFS='=' NAO serve aqui: ele descarta o '=' final do base64, e a chave de
# 44 caracteres aparece como 43 — parece chave malformada e nao e.
while read -r linha; do
  case "$linha" in ''|\#*) continue;; esac
  k=${linha%%=*}; v=${linha#*=}
  printf "  %-24s %s caracteres\n" "$k" "${#v}"
done < "$DEST"
