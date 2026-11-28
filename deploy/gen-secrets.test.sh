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
         FIELD_ENCRYPTION_KEY BLIND_INDEX_KEY QUESTIONNAIRE_SIGNING_KEY SITE_URL URI_ALLOW_LIST; do
  grep -q "^$k=." "$ENVF" && ok "$k presente e nao vazio" || falha "$k ausente ou vazio"
done
# Login (#9, L5): retorno liberado só para caminhos do próprio site.
grep -qx 'URI_ALLOW_LIST=https://[^*]*/\*\*' "$ENVF" && ok "URI_ALLOW_LIST cobre só caminhos do site" || falha "URI_ALLOW_LIST sem /**"

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
# `bloco X | grep -q` e uma CORRIDA com `set -o pipefail`, e ela nos custou um
# CI vermelho: `grep -q` sai no primeiro acerto e fecha o pipe; se o awk ainda
# tiver linhas para escrever, morre de SIGPIPE (141) e o pipefail transforma
# isso em falha do teste. O bloco do `auth` tem 163 linhas e o acerto esta na
# nona -- com o `rest`, de 24 linhas, o awk termina antes e nunca falha. O
# sintoma era "auth sem AUTH_ADMIN_PASSWORD" com o compose correto, so no
# Linux, so as vezes. Guardar em variavel tira o pipe, e a corrida, do caminho.
for svc in rest auth; do
  b=$(bloco "$svc")
  if grep -q 'POSTGRES_PASSWORD' <<< "$b"; then
    falha "o bloco do $svc no compose cita POSTGRES_PASSWORD"
  else
    ok "o bloco do $svc no compose nao cita POSTGRES_PASSWORD"
  fi
done
b=$(bloco rest)
grep -q 'AUTHENTICATOR_PASSWORD' <<< "$b" && ok "rest usa AUTHENTICATOR_PASSWORD" || falha "rest sem AUTHENTICATOR_PASSWORD"
b=$(bloco auth)
grep -q 'AUTH_ADMIN_PASSWORD' <<< "$b"    && ok "auth usa AUTH_ADMIN_PASSWORD"    || falha "auth sem AUTH_ADMIN_PASSWORD"

# Guarda contra a volta do padrao: este teste nao pode voltar a canalizar um
# bloco para `grep -q`. Falha aqui e barata; a corrida custa um CI vermelho que
# nao reproduz na maquina de quem escreveu.
if grep -qE 'bloco [a-z"$]+ *\| *grep -q' "$0"; then
  falha 'voltou o pipe de bloco para grep -q: corrida de SIGPIPE com pipefail'
else
  ok "nenhum bloco canalizado para grep -q"
fi

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

# Barra final no SITE_URL: o compose monta `${SITE_URL}/auth/v1` e o callback
# do OAuth no GoTrue e concatenacao de string, entao `https://site/` daria
# `https://site//auth/v1/callback`. O URI_ALLOW_LIST tem o mesmo problema.
ENVB="$TMPD/env-barra"
"$AQUI/gen-secrets.sh" "$ENVB" "https://exemplo.invalid/" "ambtest" > /dev/null
SB=$(grep -m1 '^SITE_URL=' "$ENVB" | cut -d= -f2-)
UB=$(grep -m1 '^URI_ALLOW_LIST=' "$ENVB" | cut -d= -f2-)
checa "barra final some do SITE_URL" "$SB" "https://exemplo.invalid"
checa "e o URI_ALLOW_LIST nao fica com //" "$UB" "https://exemplo.invalid/**"

# Google: nasce DESLIGADO e com credencial vazia. Ligar com credencial vazia
# impede o auth de subir, entao o padrao tem de ser false.
checa "GOOGLE_ENABLED nasce false" "$(val GOOGLE_ENABLED)" "false"
for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  grep -qx "$k=" "$ENVF" && ok "$k nasce vazia" || falha "$k deveria nascer vazia"
done

echo
[ "$FALHAS" -eq 0 ] && { echo "TODOS OS TESTES PASSARAM"; exit 0; } || { echo "$FALHAS teste(s) falharam"; exit 1; }
