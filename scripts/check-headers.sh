#!/usr/bin/env bash
# Confere os cabeçalhos de segurança de um ambiente publicado (#86), de fora, como o navegador vê.
# Uso: scripts/check-headers.sh https://<domínio>
# Roda no "staging de mentira" (scripts/staging-ci.sh) e, depois do deploy, contra o staging de verdade.
# Fora da imagem (scripts/ está no .dockerignore): mudar este arquivo não exige reinstalar o deploy.sh.
# Sai com 1 se algum item falhar; cada linha diz o que foi conferido.
set -u
site=${1:?uso: check-headers.sh <url do site>}
site=${site%/}
falhou=0
ok() { echo "ok: $1"; }
erro() { echo "ERRO: $1"; falhou=1; }

# Cabeçalhos de uma resposta, um por linha, nome em minúsculas, sem \r.
cabecalhos() {
  curl -sS -o /dev/null -D - --max-time 15 "$@" | tr -d '\r' \
    | awk 'BEGIN { FS = OFS = ":" } NF > 1 { $1 = tolower($1) } { print }'
}
valor() { grep "^$1:" | head -n1 | sed -E 's/^[^:]+:[[:space:]]*//'; }
nonce() { printf '%s' "$1" | grep -oE "'nonce-[^']+'" | head -n1; }

pagina=$(cabecalhos "$site/entrar")
[ -n "$pagina" ] || { echo "ERRO: $site/entrar não respondeu"; exit 1; }

csp=$(printf '%s\n' "$pagina" | valor content-security-policy)
if [ -z "$csp" ]; then
  if printf '%s\n' "$pagina" | grep -q '^content-security-policy-report-only:'; then
    erro "a CSP está só em Report-Only (CSP_REPORT_ONLY ligado): ela não bloqueia nada"
  else
    erro "sem Content-Security-Policy em /entrar"
  fi
else
  for diretiva in "default-src 'self'" "'nonce-" "'strict-dynamic'" "object-src 'none'" "base-uri 'self'" \
                  "frame-ancestors 'none'" "connect-src 'self'"; do
    case "$csp" in *"$diretiva"*) ok "CSP tem $diretiva" ;; *) erro "CSP sem $diretiva" ;; esac
  done
  case "$csp" in *"'unsafe-eval'"*) erro "CSP com 'unsafe-eval' (build de desenvolvimento?)" ;; *) ok "CSP sem 'unsafe-eval'" ;; esac
  scripts=$(printf '%s' "$csp" | tr ';' '\n' | grep -E '^[[:space:]]*script-src' || true)
  case "$scripts" in *"'unsafe-inline'"*) erro "script-src com 'unsafe-inline'" ;; *) ok "script-src sem 'unsafe-inline'" ;; esac
  outro=$(cabecalhos "$site/entrar" | valor content-security-policy)
  if [ -n "$(nonce "$csp")" ] && [ "$(nonce "$csp")" != "$(nonce "$outro")" ]; then
    ok "nonce novo a cada requisição"
  else
    erro "o nonce se repete entre requisições"
  fi
fi

confere() { # cabeçalho valor-esperado
  local atual; atual=$(printf '%s\n' "$pagina" | valor "$1")
  if [ "$atual" = "$2" ]; then ok "$1: $2"; else erro "$1 é '$atual' (esperado '$2')"; fi
}
confere x-content-type-options nosniff
confere x-frame-options DENY
confere referrer-policy strict-origin-when-cross-origin
permissoes=$(printf '%s\n' "$pagina" | valor permissions-policy)
for p in "camera=()" "microphone=()" "geolocation=()"; do
  case "$permissoes" in *"$p"*) ok "Permissions-Policy tem $p" ;; *) erro "Permissions-Policy sem $p" ;; esac
done
if printf '%s\n' "$pagina" | grep -q '^x-powered-by:'; then erro "X-Powered-By presente"; else ok "sem X-Powered-By"; fi

https=0; case "$site" in https://*) https=1 ;; esac
if [ "$https" = 1 ]; then
  idade=$(printf '%s\n' "$pagina" | valor strict-transport-security | grep -oE 'max-age=[0-9]+' | cut -d= -f2)
  if [ -n "$idade" ] && [ "$idade" -ge 15552000 ]; then ok "HSTS max-age=$idade"; else erro "HSTS ausente ou menor que 180 dias"; fi
fi

# Cookie do login (o verificador do PKCE nasce em /auth/google): HttpOnly, SameSite=Lax e, em https, Secure.
cookies=$(cabecalhos "$site/auth/google" | grep '^set-cookie:' || true)
if [ -z "$cookies" ]; then
  erro "/auth/google não pôs cookie (o Google está ligado neste ambiente?)"
else
  while IFS= read -r c; do
    nome=$(printf '%s' "$c" | sed -E 's/^set-cookie:[[:space:]]*([^=]+)=.*/\1/')
    antes=$falhou
    printf '%s' "$c" | grep -qi '; *httponly' || erro "cookie $nome sem HttpOnly"
    printf '%s' "$c" | grep -qi '; *samesite=lax' || erro "cookie $nome sem SameSite=Lax"
    if [ "$https" = 1 ] && ! printf '%s' "$c" | grep -qi '; *secure'; then erro "cookie $nome sem Secure"; fi
    [ "$falhou" = "$antes" ] && ok "cookie $nome com HttpOnly e SameSite=Lax"
  done <<< "$cookies"
fi

# Sem CORS no Auth (kong.yml, #86): um site qualquer não recebe Access-Control-Allow-Origin.
acao=$(cabecalhos -X OPTIONS -H 'Origin: https://site-qualquer.example' -H 'Access-Control-Request-Method: POST' \
  "$site/auth/v1/settings" | valor access-control-allow-origin)
if [ -z "$acao" ]; then ok "sem CORS em /auth/v1"; else erro "/auth/v1 devolve Access-Control-Allow-Origin: $acao"; fi

# Varreduras comuns não podem achar nada (no servidor, a Cloudflare bloqueia antes; aqui basta não dar 200).
for caminho in /.env /.git/config /wp-login.php /phpmyadmin/; do
  codigo=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$site$caminho" || true)
  if [ "$codigo" != 200 ] && [ "$codigo" != 000 ] && [ -n "$codigo" ]; then ok "$caminho -> $codigo"; else erro "$caminho -> $codigo"; fi
done

[ "$falhou" = 0 ] && echo "cabeçalhos de $site conferidos"
exit "$falhou"
