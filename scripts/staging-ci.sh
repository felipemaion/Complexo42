#!/usr/bin/env bash
# "Staging de mentira" (issue #319): monta o ambiente COMO NO SERVIDOR e percorre o caminho inteiro.
# O resto do CI prova o código no ambiente de desenvolvimento (supabase start, seed, docker run);
# as três falhas do staging de 2026-11-28 estavam na MONTAGEM do servidor, onde nada olhava:
#   - versão do termo ausente: o CI usa o seed.sql, o servidor não;
#   - QUESTIONNAIRE_PATH não repassado: o CI testava a imagem com `docker run`, não com o compose;
#   - pgcrypto em `public`: o banco do CI já vem com ela em `extensions`, o deploy/initdb não dizia.
#
# O que roda, na ordem do servidor, e com os MESMOS arquivos e scripts dele:
#   1. deploy/gen-secrets.sh gera o env (mais as chaves de teste do Turnstile e o SMTP do Mailpit);
#   2. deploy/docker-compose.supabase.yml + deploy/initdb + deploy/kong.yml: o banco nasce vazio;
#   3. deploy/migra.sh aplica as migrations DA IMAGEM. O seed.sql NÃO roda;
#   4. passo de operador: deploy/questionario-banco.sh (versão do termo e chave de assinatura);
#   5. deploy/docker-compose.app.yml com o questionário de exemplo em ./questionario;
#   6. um proxy no papel do proxy do servidor (scripts/staging-ci/proxy.conf.template);
#   7. e2e/staging.spec.ts: bootstrap (deploy/bootstrap-coordenacao.sh) → login → termo →
#      questionário → casa → perfil → a coordenação vê o resultado;
#   8. deploy/backup.sh e deploy/restore-test.sh com um par age descartável (só no caso normal, #84).
#
# Uso: STAGING_IMAGEM=<imagem do app já construída> scripts/staging-ci.sh [--reverter <caso>]
#   --reverter desfaz UM conserto e inverte o resultado: sai 0 só se o staging FALHAR, na etapa e
#   com o sinal esperados. É a prova de que o job pegaria cada falha de 28/11:
#     termo              -> a versão do termo não fica no banco (passo de operador esquecido)
#     questionnaire-path -> o compose do app deixa de repassar QUESTIONNAIRE_PATH (antes do #314)
#     pgcrypto           -> initdb sem `WITH SCHEMA` e sem a migration que a move (antes do #317)
# Portas só em 127.0.0.1: STAGING_PORTA (56430, o site) e STAGING_PORTA_MAILPIT (56431).
# STAGING_MANTER=1 deixa tudo de pé para inspecionar (e diz como derrubar).
set -euo pipefail
umask 077

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
REVERTER=
while [ $# -gt 0 ]; do
  case "$1" in
    --reverter) REVERTER=${2:-}; shift 2 || true ;;
    *) echo "uso: staging-ci.sh [--reverter termo|questionnaire-path|pgcrypto]" >&2; exit 2 ;;
  esac
done
case "$REVERTER" in ''|termo|questionnaire-path|pgcrypto) ;; *) echo "caso desconhecido: $REVERTER" >&2; exit 2 ;; esac
IMAGEM=${STAGING_IMAGEM:-}
[ -n "$IMAGEM" ] || { echo "falta STAGING_IMAGEM (a imagem do app, já construída)" >&2; exit 2; }
docker image inspect "$IMAGEM" > /dev/null 2>&1 || { echo "imagem não encontrada: $IMAGEM" >&2; exit 2; }

# Imagens auxiliares fixadas por digest, como as do compose. Só existem aqui: no servidor, o proxy e
# o relay de e-mail são do operador.
NGINX_IMAGEM=nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
MAILPIT_IMAGEM=axllent/mailpit:v1.27.11@sha256:e22dce5b36f93c77082e204a3942fb6b283b7896e057458400a4c88344c3df68

PROJ=c42stg; APP_PROJ=$PROJ-app
PORTA=${STAGING_PORTA:-56430}; PORTA_MAILPIT=${STAGING_PORTA_MAILPIT:-56431}
SITE=http://127.0.0.1:$PORTA
DB=$PROJ-db-1; APP=$APP_PROJ-app-1; PROXY=$PROJ-proxy; MAILPIT=$PROJ-mailpit
DIR=$(mktemp -d); ENV_FILE=$DIR/env; ETAPA_FILE=$DIR/etapa
REDE_CRIADA=

etapa() { printf '%s\n' "$1" > "$ETAPA_FILE"; printf '\n== [%s] %s\n' "$1" "$2"; }
sb() { docker compose -p "$PROJ" --env-file "$ENV_FILE" -f "$DIR/docker-compose.supabase.yml" "$@"; }
app() { APP_IMAGEM=$IMAGEM docker compose -p "$APP_PROJ" --env-file "$ENV_FILE" -f "$DIR/docker-compose.app.yml" --project-directory "$DIR" "$@"; }
psql_db() { docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }
define() { # define <chave> <valor>: troca ou acrescenta no env, sem duplicar a chave
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.novo" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.novo"; mv "$ENV_FILE.novo" "$ENV_FILE"
}

limpar() {
  local rc=$?
  if [ -n "${STAGING_MANTER:-}" ]; then
    echo "mantido de pé (STAGING_MANTER): $DIR. Para derrubar: docker compose -p $APP_PROJ e -p $PROJ down -v, e docker rm -f $PROXY $MAILPIT"
    return "$rc"
  fi
  [ -f "$DIR/docker-compose.app.yml" ] && app down -v --remove-orphans > /dev/null 2>&1 || true
  [ -f "$DIR/docker-compose.supabase.yml" ] && sb down -v --remove-orphans > /dev/null 2>&1 || true
  docker rm -f "$PROXY" "$MAILPIT" > /dev/null 2>&1 || true
  [ -n "$REDE_CRIADA" ] && docker network rm proxy > /dev/null 2>&1 || true
  rm -rf -- "$DIR"
  return "$rc"
}
trap limpar EXIT

# Diagnóstico de falha: só o fim dos logs. Segredos aqui são descartáveis (gerados neste job).
mostra_logs() {
  echo "--- app (fim) ---"; docker logs --tail 60 "$APP" 2>&1 || true
  echo "--- banco (erros) ---"; docker logs "$DB" 2>&1 | grep -E 'ERROR|FATAL' | tail -30 || true
  echo "--- auth (fim) ---"; docker logs --tail 20 "$PROJ-auth-1" 2>&1 || true
}

monta_e_testa() {
  etapa preparo "diretório do deploy, como no servidor"
  cp "$RAIZ/deploy/docker-compose.supabase.yml" "$RAIZ/deploy/kong.yml" "$RAIZ/deploy/docker-compose.app.yml" "$DIR/"
  cp -R "$RAIZ/deploy/initdb" "$DIR/initdb"
  mkdir -p "$DIR/questionario" "$DIR/data/logs"
  cp "$RAIZ/config/questionnaire.example.json" "$DIR/questionario/questionnaire.json"
  # O umask 077 é para o env; o que os containers leem precisa ser legível por eles.
  chmod -R a+rX "$DIR"
  MIGRA_DE=()
  case "$REVERTER" in
    questionnaire-path)
      grep -vE '^[[:space:]]*QUESTIONNAIRE_PATH:' "$RAIZ/deploy/docker-compose.app.yml" > "$DIR/docker-compose.app.yml" ;;
    pgcrypto)
      sed -E 's/[[:space:]]+WITH SCHEMA extensions//I' "$RAIZ/deploy/initdb/01-extensions.sql" > "$DIR/initdb/01-extensions.sql"
      chmod a+r "$DIR/initdb/01-extensions.sql"
      # As migrations continuam vindo da imagem, menos a que move a pgcrypto (se já existir).
      local criado="$PROJ-migrations-$$"
      docker create --name "$criado" "$IMAGEM" > /dev/null
      docker cp "$criado:/app/supabase/migrations" "$DIR/migrations"
      docker rm -f "$criado" > /dev/null
      rm -f "$DIR"/migrations/*_pgcrypto_extensions.sql
      MIGRA_DE=(--de "$DIR/migrations") ;;
  esac

  etapa segredos "deploy/gen-secrets.sh e o que o operador acrescenta"
  bash "$RAIZ/deploy/gen-secrets.sh" "$ENV_FILE" "$SITE" "$PROJ" > /dev/null
  # Chaves de TESTE públicas da Cloudflare (sempre passam); relay de e-mail = Mailpit.
  define TURNSTILE_SITE_KEY 1x00000000000000000000AA
  define TURNSTILE_SECRET_KEY 1x0000000000000000000000000000000AA
  define SMTP_HOST mailpit
  define SMTP_PORT 1025
  define SMTP_ADMIN_EMAIL nao-responda@exemplo.org
  define APP_ALIAS "$PROJ-app"
  define SUPABASE_NETWORK "${PROJ}_interna"
  define QUESTIONNAIRE_PATH /app/questionario/questionnaire.json
  # Google com credencial de mentira (#86): o teste só segue a navegação até o accounts.google.com,
  # passando pelo proxy e pelo kong.yml (sem CORS); nada sai para o Google de verdade.
  define GOOGLE_ENABLED true
  define GOOGLE_CLIENT_ID ci-de-mentira.apps.googleusercontent.com
  define GOOGLE_CLIENT_SECRET segredo-de-mentira-do-ci

  etapa supabase "compose do Supabase com o deploy/initdb (banco vazio)"
  sb up -d --wait --wait-timeout 300 db auth rest kong
  docker run -d --name "$MAILPIT" --network "${PROJ}_interna" --network-alias mailpit \
    -p "127.0.0.1:$PORTA_MAILPIT:8025" "$MAILPIT_IMAGEM" > /dev/null

  etapa migrations "deploy/migra.sh, migrations da imagem, sem seed"
  APP_IMAGEM=$IMAGEM DB_CONTAINER=$DB bash "$RAIZ/deploy/migra.sh" ${MIGRA_DE[@]+"${MIGRA_DE[@]}"}

  etapa operador "deploy/questionario-banco.sh (checklist do questionário em docs/OPERACAO.md)"
  DB_CONTAINER=$DB bash "$RAIZ/deploy/questionario-banco.sh" "$DIR/questionario/questionnaire.json" "$ENV_FILE"
  if [ "$REVERTER" = termo ]; then
    echo "(revertido: a versão do termo sai do banco, como no staging de 28/11)"
    psql_db -q -c "delete from app.questionnaire_term_versions" > /dev/null
  fi

  etapa app "compose do app (deploy/docker-compose.app.yml)"
  app up -d
  local i
  for i in $(seq 1 90); do
    docker exec "$APP" node -e 'fetch("http://127.0.0.1:3000/api/healthz").then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))' \
      > /dev/null 2>&1 && break
    [ "$i" = 90 ] && { echo "o app não ficou saudável em 90 s"; mostra_logs; return 1; }
    sleep 1
  done
  echo "app saudável em ${i}s"

  etapa proxy "proxy reverso na rede proxy, em $SITE"
  docker run -d --name "$PROXY" --network proxy -p "127.0.0.1:$PORTA:8080" \
    -e KONG_ALIAS="$PROJ-kong" -e APP_ALIAS="$PROJ-app" \
    -v "$RAIZ/scripts/staging-ci/proxy.conf.template:/etc/nginx/templates/default.conf.template:ro" \
    "$NGINX_IMAGEM" > /dev/null
  for i in $(seq 1 30); do
    curl -fsS "$SITE/api/healthz" > /dev/null 2>&1 && break
    [ "$i" = 30 ] && { echo "o site não respondeu pelo proxy"; docker logs "$PROXY" 2>&1 | tail -20; return 1; }
    sleep 1
  done
  # Vindas de fora (com X-Forwarded-For), as rotas sensíveis do Auth dão 404 pelo kong.yml (ADR 0018 §3).
  # O que o proxy publica é do runbook do servidor; aqui só se mede o kong.yml, que é do repositório.
  [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SITE/auth/v1/otp")" = 404 ] || { echo "o /auth/v1/otp responde de fora"; return 1; }
  etapa cabecalhos "scripts/check-headers.sh: CSP, cookies, sem CORS e varreduras (#86)"
  bash "$RAIZ/scripts/check-headers.sh" "$SITE" || return 1

  # Cadastro fechado no servidor (GOTRUE_DISABLE_SIGNUP): quem não tem conta não entra. O operador
  # cria as contas pelo deploy/criar-conta.sh (#332), como manda a receita do bootstrap; a chave de
  # serviço vai por stdin, nunca por argumento.
  etapa contas "deploy/criar-conta.sh (cadastro fechado no servidor)"
  local agora; agora=$(date +%s)
  local email="coordenacao.staging.$agora@exemplo.org" email_pessoa="pessoa.staging.$agora@exemplo.org" e
  for e in "$email" "$email_pessoa"; do
    printf '%s\n' "$e" | APP_CONTAINER=$APP bash "$RAIZ/deploy/criar-conta.sh" "$ENV_FILE"
  done

  etapa e2e "caminho inteiro no navegador (e2e/staging.spec.ts)"
  if ! (cd "$RAIZ" && E2E_STAGING_URL=$SITE E2E_STAGING_MAILPIT_URL=http://127.0.0.1:$PORTA_MAILPIT \
        E2E_STAGING_APP_CONTAINER=$APP E2E_STAGING_DB_CONTAINER=$DB E2E_STAGING_EMAIL=$email E2E_STAGING_MEMBER_EMAIL=$email_pessoa \
        E2E_STAGING_TRECHOS_FILE=$DIR/trechos \
        npx playwright test -c playwright.staging.config.ts); then
    mostra_logs; return 1
  fi

  # Backup e restauração (#84), com os scripts do servidor, sobre o banco que o E2E acabou de usar.
  # O par age é DESCARTÁVEL: nasce no diretório temporário do job (apagado na limpeza), a chave
  # privada só é lida pelo age, por caminho, e nada dela vai para log, saída ou artefato.
  [ -n "$REVERTER" ] && return 0

  # Dado pessoal em claro (#155): o que o E2E digitou (nome, WhatsApp, e-mail) não pode estar em nenhuma coluna do banco, e toda
  # coluna *_enc tem a forma cifrada. O `$DIR/trechos` nasce no diretório temporário do job (apagado na limpeza); a saída traz só
  # esquema.tabela.coluna, nunca o valor, e nenhum dump é feito.
  etapa varredura "dado pessoal em claro no banco (scripts/staging-ci/varredura.sh)"
  DB=$DB bash "$RAIZ/scripts/staging-ci/varredura.sh" "$DIR/trechos"
  # A varredura morde: um texto em claro plantado numa coluna comum TEM de ser achado (e a tabela de prova some).
  psql_db -q -c "create table public.varredura_prova (t text); insert into public.varredura_prova values ('Prova De Texto Em Claro 7391')" > /dev/null
  printf 'claro:Prova De Texto Em Claro 7391\n' > "$DIR/trechos-prova"
  if DB=$DB bash "$RAIZ/scripts/staging-ci/varredura.sh" "$DIR/trechos-prova" > "$DIR/prova.saida" 2>&1; then
    echo "ERRO: a varredura não achou um texto em claro plantado"; return 1
  fi
  grep -q 'public.varredura_prova.t' "$DIR/prova.saida" || { echo "ERRO: a varredura não apontou a coluna plantada"; return 1; }
  psql_db -q -c "drop table public.varredura_prova" > /dev/null
  etapa backup "deploy/backup.sh e deploy/restore-test.sh (par age descartável)"
  command -v age-keygen > /dev/null || { echo "sem age-keygen no runner"; return 1; }
  local chave="$DIR/chave-age-descartavel" publica arq
  age-keygen -o "$chave" 2> /dev/null
  publica=$(age-keygen -y "$chave")
  COMPOSE_FILE="$DIR/docker-compose.supabase.yml" ENV_FILE="$ENV_FILE" PROJECT_DIR="$DIR" \
    BACKUP_DIR="$DIR/backups" AGE_RECIPIENT="$publica" bash "$RAIZ/deploy/backup.sh"
  arq=$(ls -1t "$DIR"/backups/diario/*.age | head -n1)
  # O que o E2E deixou: 2 perfis, 2 casas aceitas, 1 papel (a coordenação), a raiz e os municípios.
  MINIMOS="perfis=2 casas=2 papeis=1 unidades=1 municipios=5000" REGISTRO="$DIR/backup.log" \
    INITDB_DIR="$DIR/initdb" bash "$RAIZ/deploy/restore-test.sh" "$arq" "$chave"
  # A conferência morde: um mínimo impossível TEM de reprovar.
  if MINIMOS="perfis=999999" INITDB_DIR="$DIR/initdb" bash "$RAIZ/deploy/restore-test.sh" "$arq" "$chave" > /dev/null 2>&1; then
    echo "ERRO: o restore-test aprovou um banco abaixo do minimo"; return 1
  fi
  grep -q ' restore-test ok segundos=' "$DIR/backup.log" || { echo "o registro do restore-test nao saiu"; return 1; }
  if grep -q 'AGE-SECRET-KEY' "$DIR/backup.log"; then echo "ERRO: a chave privada foi parar no registro"; return 1; fi
  cat "$DIR/backup.log"
}

# O subshell roda com -e próprio e o código dele decide. O trap de limpeza fica fora, para os
# containers (e os logs) ainda existirem na conferência do caso revertido.
# A rede `proxy` (externa nos dois composes) nasce AQUI, fora do subshell: marcada lá dentro, a
# limpeza nunca saberia que foi este script que a criou.
if ! docker network inspect proxy > /dev/null 2>&1; then docker network create proxy > /dev/null; REDE_CRIADA=1; fi
set +e
( set -e; monta_e_testa )
rc=$?
set -e
etapa_final=$(cat "$ETAPA_FILE" 2>/dev/null || echo "?")

if [ -z "$REVERTER" ]; then
  if [ "$rc" = 0 ]; then echo "OK: staging de mentira passou"; else echo "FALHOU na etapa: $etapa_final"; fi
  exit "$rc"
fi

# Caso revertido: tem de falhar, na etapa certa e pelo motivo certo. Falhar por outro motivo não
# prova nada (um timeout qualquer passaria por "pegou a falha").
case "$REVERTER" in
  # Desde o #325 o healthz confere a versão do termo: o app não fica saudável, antes do navegador.
  termo)              esperada=app; log=$(docker logs "$APP" 2>&1 || true); sinal='healthz_terms_missing' ;;
  questionnaire-path) esperada=app; log=$(docker logs "$APP" 2>&1 || true); sinal='QUESTIONNAIRE_PATH' ;;
  pgcrypto)           esperada=e2e; log=$(docker logs "$DB" 2>&1 || true);  sinal='extensions\.(digest|hmac).* does not exist' ;;
esac
echo
if [ "$rc" = 0 ]; then
  echo "ERRO: com o conserto revertido ($REVERTER), o staging PASSOU: o job não pegaria a falha"; exit 1
fi
if [ "$etapa_final" != "$esperada" ]; then
  echo "ERRO: revertido ($REVERTER), falhou na etapa '$etapa_final', não na '$esperada'"; exit 1
fi
if ! printf '%s' "$log" | grep -Eq "$sinal"; then
  echo "ERRO: revertido ($REVERTER), falhou na etapa certa mas sem o sinal /$sinal/ no log"; exit 1
fi
echo "OK: revertido ($REVERTER), o staging falhou na etapa '$esperada' com /$sinal/ no log, como em 28/11"
