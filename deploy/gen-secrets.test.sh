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

for k in COMPOSE_PROJECT_NAME KONG_ALIAS POSTGRES_PASSWORD AUTHENTICATOR_PASSWORD \
         AUTH_ADMIN_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY \
         FIELD_ENCRYPTION_KEY BLIND_INDEX_KEY SITE_URL URI_ALLOW_LIST; do
  grep -q "^$k=." "$ENVF" && ok "$k presente e nao vazio" || falha "$k ausente ou vazio"
done

val(){ grep -m1 "^$1=" "$ENVF" | cut -d= -f2-; }
P=$(val POSTGRES_PASSWORD); checa "POSTGRES_PASSWORD 40 chars" "${#P}" "40"
PA=$(val AUTHENTICATOR_PASSWORD); checa "AUTHENTICATOR_PASSWORD 40 chars" "${#PA}" "40"
PB=$(val AUTH_ADMIN_PASSWORD);    checa "AUTH_ADMIN_PASSWORD 40 chars"    "${#PB}" "40"
J=$(val JWT_SECRET);        checa "JWT_SECRET 64 chars"        "${#J}" "64"
F=$(val FIELD_ENCRYPTION_KEY); checa "FIELD_ENCRYPTION_KEY 32 bytes em base64" "${#F}" "44"
B=$(val BLIND_INDEX_KEY);      checa "BLIND_INDEX_KEY 32 bytes em base64"      "${#B}" "44"

[ "$F" != "$B" ] && ok "as duas chaves do ADR 0003 sao diferentes" \
                 || falha "FIELD_ENCRYPTION_KEY e BLIND_INDEX_KEY iguais"

# As tres senhas do Postgres sao distintas (#95): senha compartilhada faz do
# vazamento do ambiente do rest ou do auth um vazamento de superusuario.
if [ "$P" != "$PA" ] && [ "$P" != "$PB" ] && [ "$PA" != "$PB" ]; then
  ok "as tres senhas do Postgres sao distintas"
else
  falha "senha repetida entre papeis do Postgres"
fi

for par in "superusuario:$P" "authenticator:$PA" "auth_admin:$PB"; do
  case "${par#*:}" in
    *[!A-Za-z0-9]*) falha "senha de ${par%%:*} tem char que quebra URI";;
    *)              ok "senha de ${par%%:*} segura em URI";;
  esac
done

# ── O compose nao entrega a senha do superusuario ao rest nem ao auth (#95) ──
# Checagem estatica (nao precisa de Docker): le o bloco de cada servico no YAML.
COMPOSE="$AQUI/docker-compose.supabase.yml"
bloco(){ awk -v s="  $1:" '$0==s{d=1;next} d&&/^  [a-z#]/{exit} d' "$COMPOSE"; }
for svc in rest auth; do
  if bloco "$svc" | grep -q 'POSTGRES_PASSWORD'; then
    falha "o bloco do $svc no compose cita POSTGRES_PASSWORD"
  else
    ok "o bloco do $svc no compose nao cita POSTGRES_PASSWORD"
  fi
done
bloco rest | grep -q 'AUTHENTICATOR_PASSWORD' && ok "rest usa AUTHENTICATOR_PASSWORD" || falha "rest sem AUTHENTICATOR_PASSWORD"
bloco auth | grep -q 'AUTH_ADMIN_PASSWORD'    && ok "auth usa AUTH_ADMIN_PASSWORD"    || falha "auth sem AUTH_ADMIN_PASSWORD"

# Checagem no config renderizado, quando ha Docker: compara VALOR, nao nome --
# e o teste que pega interpolacao errada. Fora do servidor o Docker costuma
# faltar, e ai o teste avisa em vez de falhar (a checagem estatica ja rodou).
if docker compose version > /dev/null 2>&1; then
  if (cd "$AQUI" && docker compose -f docker-compose.supabase.yml --env-file "$ENVF" \
        config --format json) > "$TMPD/config.json" 2> "$TMPD/config.err"; then
    ENVF="$ENVF" CFG="$TMPD/config.json" python3 - <<'PYCFG' && ok "config renderizado: rest e auth sem a senha do superusuario" || falha "config renderizado expoe senha errada"
import json, os, sys
seg = {}
for linha in open(os.environ["ENVF"], encoding="utf-8"):
    if linha.startswith("#") or "=" not in linha: continue
    k, _, v = linha.rstrip("\n").partition("=")
    seg[k] = v
servicos = json.load(open(os.environ["CFG"], encoding="utf-8")).get("services", {})
def ambiente(svc):
    amb = servicos.get(svc, {}).get("environment") or {}
    return " ".join(str(v) for v in amb.values())
for svc, chave in (("rest", "AUTHENTICATOR_PASSWORD"), ("auth", "AUTH_ADMIN_PASSWORD")):
    amb = ambiente(svc)
    if seg["POSTGRES_PASSWORD"] in amb:
        sys.exit("%s recebeu a senha do superusuario" % svc)
    if seg[chave] not in amb:
        sys.exit("%s nao recebeu a propria senha (%s)" % (svc, chave))
# o db precisa das tres: e ele quem cria os papeis no initdb
amb_db = ambiente("db")
for chave in ("POSTGRES_PASSWORD", "AUTHENTICATOR_PASSWORD", "AUTH_ADMIN_PASSWORD"):
    if seg[chave] not in amb_db:
        sys.exit("db sem %s" % chave)
PYCFG
  else
    falha "docker compose config falhou (erro, sem segredo, em $TMPD/config.err)"
  fi
else
  printf "  nota  sem Docker aqui: so a checagem estatica do compose rodou\n"
fi

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
