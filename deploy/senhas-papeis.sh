#!/usr/bin/env bash
# Senhas por papel do Postgres num banco que JÁ EXISTE (#95). O deploy/initdb/02-roles.sh só roda no
# primeiro start de um volume vazio; este script confere, aplica e rotaciona depois disso.
#
#   deploy/senhas-papeis.sh --conferir                 só lê: ok ou FALHA por item, nenhuma senha impressa
#   deploy/senhas-papeis.sh --aplicar                  senhas do arquivo de segredos nos papéis e postgres
#                                                      sem login; reinicia rest e auth; confere no fim
#   deploy/senhas-papeis.sh --rotacionar AUTHENTICATOR_PASSWORD | AUTH_ADMIN_PASSWORD
#                                                      senha nova no arquivo e no banco, recria só o serviço
#                                                      dela e espera a saúde; falhou, volta arquivo E banco
#
# Ambiente: COMPOSE_FILE (o docker-compose.supabase.yml), ENV_FILE (o secrets/env), SUPABASE_PROJETO
# (projeto Compose do Supabase). Opcional: SAUDE_CMD (ex.: "curl -fsS https://<domínio>/api/healthz"),
# conferido depois da rotação; ESPERA_SAUDE em segundos (120).
# A senha do superusuário (POSTGRES_PASSWORD) não roda por aqui: trocá-la recria o container do banco,
# então é passo manual com janela (docs/OPERACAO.md, "Senhas por papel do Postgres").
#
# Segredo: nenhuma senha em argumento de processo (vão por stdin ou pelo ambiente do processo filho),
# nenhuma no terminal nem no log, e nenhum arquivo temporário com a senha nova além do próprio arquivo
# de segredos (temporário 0600 na mesma pasta, para o mv ser atômico). Falha fechado: set -eu, backup
# do arquivo e conferência do arquivo inteiro antes e depois de reescrever.
set -euo pipefail
umask 077
{ set +x; } 2> /dev/null

: "${COMPOSE_FILE:?falta COMPOSE_FILE}" "${ENV_FILE:?falta ENV_FILE}" "${SUPABASE_PROJETO:?falta SUPABASE_PROJETO}"
ESPERA_SAUDE=${ESPERA_SAUDE:-120}
SAUDE_CMD=${SAUDE_CMD:-}
[ -f "$ENV_FILE" ] || { echo "ERRO: $ENV_FILE não existe" >&2; exit 2; }

dc() { docker compose -p "$SUPABASE_PROJETO" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
# SQL por stdin, como supabase_admin pelo socket do container (sem senha de rede).
sql() { dc exec -T db psql -X -q -tA -v ON_ERROR_STOP=1 -U supabase_admin -d postgres; }

# Valor de uma chave: exatamente uma linha, só letras e números (é o que o gen-secrets gera; garante
# que o valor entra no SQL sem escapar nada).
valor() { # valor <chave>
  local n v
  n=$(grep -c "^$1=" "$ENV_FILE" || true)
  [ "$n" = 1 ] || { echo "ERRO: $1 aparece $n vezes em $ENV_FILE (esperado 1)" >&2; return 1; }
  v=$(sed -n "s/^$1=//p" "$ENV_FILE")
  [[ "$v" =~ ^[A-Za-z0-9]{20,}$ ]] || { echo "ERRO: $1 fora do formato (letras e números, 20 ou mais)" >&2; return 1; }
  printf '%s' "$v"
}

define_senha() { # define_senha <papel> <senha>: a senha vai no stdin do psql, nunca em argumento
  printf "set log_statement = 'none';\n\\\\set s '%s'\nalter role %s with login password :'s';\n" "$2" "$1" | sql > /dev/null
}

# Login de verdade, por TCP, com a senha lida do stdin dentro do container. Pelo IP da rede do
# container, que é o caminho do rest e do auth: no 127.0.0.1 o pg_hba da imagem confia sem senha, e o
# teste provaria nada (medido no staging de mentira).
entra() { # entra <papel> <senha>
  local r
  r=$(printf '%s\n' "$2" | dc exec -T db sh -c \
    'IFS= read -r PGPASSWORD; export PGPASSWORD; ip=$(hostname -i | cut -d" " -f1); psql -X -h "$ip" -U "$1" -d postgres -tAc "select 1"' _ "$1" 2> /dev/null) || return 1
  [ "$r" = 1 ]
}

falhou=0
ok() { echo "ok: $1"; }
falha() { echo "FALHA: $1"; falhou=1; }

conferir() {
  local P A G estado esperado svc cid envs
  P=$(valor POSTGRES_PASSWORD); A=$(valor AUTHENTICATOR_PASSWORD); G=$(valor AUTH_ADMIN_PASSWORD)
  if [ "$P" != "$A" ] && [ "$P" != "$G" ] && [ "$A" != "$G" ]; then ok "três senhas distintas no arquivo"; else falha "senhas repetidas no arquivo de segredos"; fi
  estado=$(printf '%s\n' "select rolname || '|' || (case when rolcanlogin then 't' else 'f' end) || '|' || (case when rolpassword is null then 'f' else 't' end) from pg_authid where rolname in ('postgres', 'authenticator', 'supabase_auth_admin') order by 1;" | sql)
  # papel|pode entrar|tem senha (t/f escritos no SQL: booleano concatenado vira true/false)
  for esperado in "authenticator|t|t" "postgres|f|f" "supabase_auth_admin|t|t"; do
    if grep -qx "$esperado" <<< "$estado"; then ok "papel ${esperado%%|*}: login e senha como esperado"; else falha "papel ${esperado%%|*}: login ou senha fora do esperado"; fi
  done
  # O próprio teste de login tem de exigir senha: com uma errada, ninguém entra.
  if entra authenticator "senha-errada-de-proposito"; then falha "o login de teste entrou com senha errada (pg_hba sem senha?): os itens de login abaixo não valem"; fi
  if entra authenticator "$A"; then ok "authenticator entra com a própria senha"; else falha "authenticator não entra com a própria senha"; fi
  if entra supabase_auth_admin "$G"; then ok "supabase_auth_admin entra com a própria senha"; else falha "supabase_auth_admin não entra com a própria senha"; fi
  if entra authenticator "$P" || entra supabase_auth_admin "$P"; then falha "a senha do superusuário entra num papel de serviço"; else ok "a senha do superusuário não entra nos papéis de serviço"; fi
  for svc in rest auth; do
    cid=$(dc ps -q "$svc" 2> /dev/null | head -n1)
    if [ -z "$cid" ]; then falha "$svc não está rodando"; continue; fi
    envs=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid")
    if grep -q '^POSTGRES_PASSWORD=' <<< "$envs" || grep -qF -- "$P" <<< "$envs"; then
      falha "o container $svc recebe a senha do superusuário"
    else
      ok "o container $svc não recebe a senha do superusuário"
    fi
  done
  return "$falhou"
}

aplicar() {
  local A G
  A=$(valor AUTHENTICATOR_PASSWORD); G=$(valor AUTH_ADMIN_PASSWORD)
  define_senha authenticator "$A"
  define_senha supabase_auth_admin "$G"
  printf '%s\n' "alter role postgres with nologin password null;" | sql > /dev/null
  echo "aplicado: authenticator e supabase_auth_admin com a senha do arquivo; postgres sem login"
  # A conexão antiga segue valendo até o processo reconectar: reiniciar agora, não descobrir horas depois.
  dc restart rest auth > /dev/null
  conferir
}

saudavel() { # saudavel <papel> <senha> <serviço>
  local fim=$(( $(date +%s) + ESPERA_SAUDE )) cid st
  while [ "$(date +%s)" -le "$fim" ]; do
    cid=$(dc ps -q "$3" 2> /dev/null | head -n1)
    st=""
    [ -n "$cid" ] && st=$(docker inspect -f '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$cid" 2> /dev/null || true)
    if { [ "$st" = running ] || [ "$st" = running/healthy ]; } && entra "$1" "$2" \
       && { [ -z "$SAUDE_CMD" ] || bash -c "$SAUDE_CMD" > /dev/null 2>&1; }; then
      return 0
    fi
    sleep "${ESPERA_PASSO:-3}"
  done
  return 1
}

rotacionar() {
  local chave=$1 papel svc antiga nova dir tmp linhas
  case "$chave" in
    AUTHENTICATOR_PASSWORD) papel=authenticator; svc=rest ;;
    AUTH_ADMIN_PASSWORD) papel=supabase_auth_admin; svc=auth ;;
    *) echo "ERRO: só AUTHENTICATOR_PASSWORD ou AUTH_ADMIN_PASSWORD (a do superusuário é passo manual)" >&2; exit 2 ;;
  esac
  antiga=$(valor "$chave")
  nova=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 40 || true)
  [ "${#nova}" = 40 ] || { echo "ERRO: não gerei a senha nova" >&2; exit 1; }
  dir=$(dirname "$ENV_FILE"); linhas=$(wc -l < "$ENV_FILE")
  BACKUP="$ENV_FILE.antes-da-rotacao"
  cp -p "$ENV_FILE" "$BACKUP"
  cmp -s "$ENV_FILE" "$BACKUP" || { echo "ERRO: o backup não confere" >&2; rm -f "$BACKUP"; exit 1; }

  # Arquivo novo: só a linha da chave muda. A senha nova chega ao awk pelo ambiente, não por argumento.
  tmp=$(mktemp "$dir/.env.rotacao.XXXXXX")
  NOVA_SENHA=$nova awk -v k="$chave" 'index($0, k "=") == 1 { print k "=" ENVIRON["NOVA_SENHA"]; next } { print }' "$ENV_FILE" > "$tmp"
  if [ "$(wc -l < "$tmp")" != "$linhas" ] || [ "$(grep -c "^$chave=" "$tmp")" != 1 ] \
     || ! cmp -s <(grep -v "^$chave=" "$ENV_FILE") <(grep -v "^$chave=" "$tmp") \
     || [ "$(sed -n "s/^$chave=//p" "$tmp")" != "$nova" ]; then
    rm -f "$tmp" "$BACKUP"; echo "ERRO: o arquivo reescrito não confere; nada mudou" >&2; exit 1
  fi
  chmod "$(stat -c %a "$ENV_FILE" 2> /dev/null || stat -f %Lp "$ENV_FILE")" "$tmp"
  mv "$tmp" "$ENV_FILE"

  desfaz() {
    echo "falhou: devolvendo o arquivo e a senha antiga no banco" >&2
    cp -p "$BACKUP" "$ENV_FILE"
    cmp -s "$ENV_FILE" "$BACKUP" || { echo "ALERTA: o arquivo não voltou; o backup está em $BACKUP" >&2; exit 1; }
    define_senha "$papel" "$antiga" || echo "ALERTA: a senha antiga não voltou ao banco" >&2
    dc up -d --no-deps --force-recreate "$svc" > /dev/null 2>&1 || true
    if saudavel "$papel" "$antiga" "$svc"; then echo "voltou ao estado anterior (senha antiga)" >&2
    else echo "ALERTA: mesmo com a senha antiga o $svc não ficou saudável" >&2; fi
    rm -f "$BACKUP"
    exit 1
  }
  define_senha "$papel" "$nova" || desfaz
  dc up -d --no-deps --force-recreate "$svc" > /dev/null || desfaz
  saudavel "$papel" "$nova" "$svc" || desfaz
  if entra "$papel" "$antiga"; then echo "ERRO: a senha antiga ainda entra" >&2; desfaz; fi
  rm -f "$BACKUP"
  echo "ok: $chave rotacionada; $svc recriado e saudável; a senha antiga não entra mais"
}

case "${1:-}" in
  --conferir) conferir ;;
  --aplicar) aplicar ;;
  --rotacionar) rotacionar "${2:?uso: --rotacionar AUTHENTICATOR_PASSWORD|AUTH_ADMIN_PASSWORD}" ;;
  *) echo "uso: senhas-papeis.sh --conferir | --aplicar | --rotacionar <chave>" >&2; exit 2 ;;
esac
