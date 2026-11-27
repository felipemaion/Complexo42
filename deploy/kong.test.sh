#!/usr/bin/env bash
# Mede o deploy/kong.yml com o Kong de verdade (mesma imagem do compose), sem Auth atras: 404 e a
# regra do Kong; 502/503 e "passou" (o upstream nao existe aqui). ADR 0018 §3.
set -euo pipefail
cd "$(dirname "$0")/.."
imagem=$(grep -oE 'image: kong:[^[:space:]]+' deploy/docker-compose.supabase.yml | head -n1 | cut -d' ' -f2)
# O digest do compose e da imagem ARM64 (servidor); o runner do CI e amd64. Mesma versao, sem digest.
imagem=${imagem%%@*}
dir=$(mktemp -d); nome="kong-teste-$$"; porta=${KONG_TESTE_PORTA:-18080}
trap 'docker rm -f "$nome" >/dev/null 2>&1 || true; rm -rf "$dir"' EXIT
cp deploy/kong.yml "$dir/kong.yml"
# O Kong roda como usuario sem privilegio: o diretorio do mktemp (0700) precisa ser legivel.
chmod 755 "$dir"; chmod 644 "$dir/kong.yml"
docker run -d --name "$nome" -p "$porta:8000" -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/k/kong.yml \
  -e KONG_PROXY_LISTEN=0.0.0.0:8000 -v "$dir:/k:ro" "$imagem" >/dev/null
pronto=0
for _ in $(seq 1 45); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "localhost:$porta/auth/v1/verify" || true)" != 000 ] && { pronto=1; break; }
  sleep 2
done
[ "$pronto" = 1 ] || { echo "ERRO: o Kong nao subiu"; docker logs "$nome" 2>&1 | tail -15; exit 1; }

falhou=0
codigo() { curl -s -o /dev/null -w '%{http_code}' -X POST "$@"; }
espera() { # descricao esperado codigo-real
  if [ "$3" = "$2" ] || { [ "$2" = passa ] && [ "$3" != 404 ] && [ "$3" != 000 ]; }; then echo "ok: $1 -> $3"; else echo "ERRO: $1 -> $3 (esperado $2)"; falhou=1; fi
}
base="localhost:$porta"
for caminho in "/auth/v1/token?grant_type=password" /auth/v1/recover /auth/v1/otp /auth/v1/user "//auth/v1/token" "/auth/v1/%74oken"; do
  espera "de fora $caminho" 404 "$(codigo -H 'X-Forwarded-For: 203.0.113.9' "$base$caminho")"
  espera "interno $caminho" passa "$(codigo "$base$caminho")"
done
# O que o NAVEGADOR faz de fora (so segue redirecionamentos): Google (authorize e callback) e
# link do e-mail (verify). Nao pode dar 404. Metodo GET, como o navegador.
for caminho in /auth/v1/verify "/auth/v1/authorize?provider=google" /auth/v1/callback; do
  espera "navegador (GET de fora) $caminho" passa "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.9' "$base$caminho")"
done
espera "signup (qualquer origem)" 404 "$(codigo "$base/auth/v1/signup")"
espera "signup de fora" 404 "$(codigo -H 'X-Forwarded-For: 203.0.113.9' "$base/auth/v1/signup")"
exit $falhou
