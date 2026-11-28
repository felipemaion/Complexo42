#!/usr/bin/env bash
# Verifica a imagem do app (#80). Uso: scripts/check-image.sh <imagem>
# Roda no CI e serve de teste de fumaça local. Não precisa de banco nem de
# PostgREST: um dublê de 20 linhas, rodando na MESMA pilha de rede do container
# do app (`--network container:`), responde pelos dois. Duas portas, porque o
# healthz tem duas sondas e elas falham por motivos diferentes:
#   9990 -> 200 "[]" em qualquer caminho
#   9991 -> esquema velho (404 PGRST205 em /rest/v1/*), o estado que deixou o
#           staging 19 horas servindo 404 com o healthz em 200 (2026-11-27)
#   9992 -> 401 com 42501 em /rest/v1/*: privilégio recusado ao papel `anon`.
#           É o ramo que roda EM PRODUÇÃO -- `profiles` tem grant só para
#           `authenticated` --, e ele tem de contar como esquema saudável,
#           porque o erro só existe depois de o PostgREST resolver a tabela.
set -euo pipefail
img="${1:?uso: $0 <imagem>}"
# Chaves de cifra de TESTE, 32 bytes em base64. Obrigatórias em produção desde
# 2026-11-28: sem elas o processo recusa subir -- que é exatamente o conserto.
# base64 de 32 bytes, nao 43 caracteres iguais mais "=": o app exige que a
# chave sobreviva ao round-trip base64, e so o primeiro jeito garante isso.
CHAVE_TESTE_A=$(printf 'a%.0s' $(seq 1 32) | base64 | tr -d '\n')
CHAVE_TESTE_B=$(printf 'b%.0s' $(seq 1 32) | base64 | tr -d '\n')
# Questionário de EXEMPLO, montado só neste teste: em produção o app exige QUESTIONNAIRE_PATH (#313).
EXEMPLO_QUESTIONARIO="$(cd "$(dirname "$0")/.." && pwd)/config/questionnaire.example.json"
[ -f "$EXEMPLO_QUESTIONARIO" ] || { echo "FALHOU: sem $EXEMPLO_QUESTIONARIO" >&2; exit 1; }
name="healthz-check-$$"
fail() { echo "FALHOU: $*" >&2; exit 1; }
cleanup() { docker rm -f "$name" "$name-rest" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1) nenhum .env na imagem"
found=$(docker run --rm "$img" sh -c 'find / -xdev -name ".env*" 2>/dev/null; true')
[ -z "$found" ] || fail ".env encontrado: $found"

echo "2) usuário não-root"
uid=$(docker run --rm "$img" id -u)
[ "$uid" != "0" ] || fail "roda como root"

echo "3) tamanho < 250 MB (descompactada)"
# `docker image inspect .Size` muda conforme o armazenamento (compactado no
# containerd, descompactado no overlay2). O `du` do sistema de arquivos não.
mb=$(docker run --rm "$img" sh -c 'du -sxm / 2>/dev/null | cut -f1')
echo "   $mb MB"
[ "$mb" -lt 250 ] || fail "imagem grande demais"

echo "4) sem DB_HEALTH_URL em produção, o processo cai sem imprimir valores"
set +e
out=$(docker run --rm -e HEALTH_TIMEOUT_MS=valor-secreto "$img" 2>&1)
code=$?
set -e
[ "$code" -ne 0 ] || fail "subiu sem configuração"
grep -q "DB_HEALTH_URL" <<<"$out" || fail "mensagem não cita a variável"
grep -q "QUESTIONNAIRE_PATH" <<<"$out" || fail "mensagem não cita QUESTIONNAIRE_PATH (obrigatória em produção, #313)"
! grep -q "valor-secreto" <<<"$out" || fail "valor vazou no log"

# Dublê de PostgREST, nas duas portas. Fica na pilha de rede do container do
# app, entao o app o alcança em 127.0.0.1 -- sem rede nova e sem rota do host.
DUBLE_JS='const h=require("http");
const vazio=(q,s)=>{s.writeHead(200,{"content-type":"application/json"});s.end("[]")};
const erro=(cod,corpo)=>(q,s)=>{if(q.url.startsWith("/rest/v1/")){s.writeHead(cod,{"content-type":"application/json"});s.end(JSON.stringify(corpo))}else{vazio(q,s)}};
h.createServer(vazio).listen(9990,"0.0.0.0");
h.createServer(erro(404,{code:"PGRST205",message:"Could not find the table in the schema cache"})).listen(9991,"0.0.0.0");
h.createServer(erro(401,{code:"42501",message:"permission denied for table profiles"})).listen(9992,"0.0.0.0");'

# Sobe só leitura, com /tmp em memória, e consulta o healthz de dentro do container.
# $1 = DB_HEALTH_URL   $2 = SUPABASE_URL
healthz() {
  # Login (#9) e Turnstile (#116): obrigatórios em produção. Valores fictícios (chaves de
  # teste públicas da Cloudflare); o healthz não depende do Auth.
  docker run -d --name "$name" --read-only --tmpfs /tmp -e DB_HEALTH_URL="$1" \
    -e SUPABASE_URL="$2" -e SITE_URL=http://127.0.0.1:3000 \
    -e TURNSTILE_SITE_KEY=1x00000000000000000000AA -e TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
    -e FIELD_ENCRYPTION_KEY="$CHAVE_TESTE_A" -e BLIND_INDEX_KEY="$CHAVE_TESTE_B" \
    -v "$EXEMPLO_QUESTIONARIO:/tmp/questionnaire.json:ro" -e QUESTIONNAIRE_PATH=/tmp/questionnaire.json \
    -e SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiJ9.$(printf %s '{"role":"anon"}' | base64).ci" "$img" >/dev/null
  # O dublê entra DEPOIS, na pilha de rede do app, e precisa dele de pé.
  docker run -d --name "$name-rest" --network "container:$name" --read-only \
    --entrypoint node "$img" -e "$DUBLE_JS" >/dev/null
  # Imprime "<status> <cache-control>" e o corpo. wget do busybox esconde o corpo do 503.
  local js='fetch("http://127.0.0.1:3000/api/healthz").then(async r=>console.log(r.status, r.headers.get("cache-control"), await r.text()))'
  for _ in $(seq 1 30); do
    body=$(docker exec "$name" node -e "$js" 2>&1) && break
    sleep 1
  done
  cleanup
  echo "$body"
}

echo "5) banco e esquema no ar: 200 ok"
body=$(healthz "http://127.0.0.1:9990/ready" "http://127.0.0.1:9990")
grep -q '"status":"ok"' <<<"$body" || fail "esperava ok: $body"
grep -q '"schema":"ok"' <<<"$body" || fail "esperava schema ok: $body"
grep -q "^200 no-store " <<<"$body" || fail "esperava 200 com Cache-Control no-store: $body"

echo "6) banco fora: 503 degradado, sem detalhe de erro"
body=$(healthz "http://127.0.0.1:9/ready" "http://127.0.0.1:9990")
grep -q "^503 no-store " <<<"$body" || fail "esperava 503 com Cache-Control no-store: $body"
grep -q '"db":"unavailable"' <<<"$body" || fail "esperava db unavailable: $body"
! grep -qiE "ECONNREFUSED|127\.0\.0\.1|stack" <<<"$body" || fail "detalhe de erro vazou"

# O caso que o healthz NAO pegava: processo de pé, API de dados inútil.
echo "7) banco no ar e esquema velho: 503, sem vazar a mensagem do PostgREST"
body=$(healthz "http://127.0.0.1:9990/ready" "http://127.0.0.1:9991")
grep -q "^503 no-store " <<<"$body" || fail "esperava 503: $body"
grep -q '"db":"ok"' <<<"$body" || fail "esperava db ok: $body"
grep -q '"schema":"stale"' <<<"$body" || fail "esperava schema stale: $body"
! grep -qiE "PGRST205|schema cache|stack" <<<"$body" || fail "detalhe do PostgREST vazou"

# O ramo que roda em produção: `profiles` só tem grant para `authenticated`,
# então a sonda SEMPRE leva 401/42501. Se este caso der 503, o healthz passa a
# acusar esquema velho em toda requisição de um ambiente saudável.
echo "8) 401 com 42501 (privilegio recusado ao anon): esquema saudavel, 200"
body=$(healthz "http://127.0.0.1:9990/ready" "http://127.0.0.1:9992")
grep -q "^200 no-store " <<<"$body" || fail "esperava 200: $body"
grep -q '"schema":"ok"' <<<"$body" || fail "esperava schema ok: $body"
! grep -qiE "42501|permission denied|stack" <<<"$body" || fail "detalhe do Postgres vazou"

echo "OK: imagem aprovada"
