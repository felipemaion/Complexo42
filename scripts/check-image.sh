#!/usr/bin/env bash
# Verifica a imagem do app (#80). Uso: scripts/check-image.sh <imagem>
# Roda no CI e serve de teste de fumaça local. Não precisa de banco: para o
# caminho feliz, aponta DB_HEALTH_URL para a própria página inicial do app.
set -euo pipefail
img="${1:?uso: $0 <imagem>}"
name="healthz-check-$$"
fail() { echo "FALHOU: $*" >&2; exit 1; }
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
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
! grep -q "valor-secreto" <<<"$out" || fail "valor vazou no log"

# Sobe só leitura, com /tmp em memória, e consulta o healthz de dentro do container.
healthz() {
  docker run -d --name "$name" --read-only --tmpfs /tmp -e DB_HEALTH_URL="$1" "$img" >/dev/null
  # Imprime "<status> <cache-control>" e o corpo. wget do busybox esconde o corpo do 503.
  local js='fetch("http://127.0.0.1:3000/api/healthz").then(async r=>console.log(r.status, r.headers.get("cache-control"), await r.text()))'
  for _ in $(seq 1 30); do
    body=$(docker exec "$name" node -e "$js" 2>&1) && break
    sleep 1
  done
  cleanup
  echo "$body"
}

echo "5) banco no ar (só leitura): 200 ok"
body=$(healthz "http://127.0.0.1:3000/")
grep -q '"status":"ok"' <<<"$body" || fail "esperava ok: $body"
grep -q "^200 no-store " <<<"$body" || fail "esperava 200 com Cache-Control no-store: $body"

echo "6) banco fora: 503 degradado, sem detalhe de erro"
body=$(healthz "http://127.0.0.1:9/ready")
grep -q "^503 no-store " <<<"$body" || fail "esperava 503 com Cache-Control no-store: $body"
grep -q '"db":"unavailable"' <<<"$body" || fail "esperava db unavailable: $body"
! grep -qiE "ECONNREFUSED|127\.0\.0\.1|stack" <<<"$body" || fail "detalhe de erro vazou"

echo "OK: imagem aprovada"
