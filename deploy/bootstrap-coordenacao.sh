#!/usr/bin/env bash
# Bootstrap da primeira coordenação (issue #295): autoriza um e-mail e, se a pessoa já tem perfil
# ativo, a faz gestora da raiz. Para banco novo, onde ninguém pode autorizar ninguém.
#
# Uso (no servidor, como operador):
#   APP_CONTAINER=<container do app> DB_CONTAINER=<container do banco> \
#     deploy/bootstrap-coordenacao.sh [--adicionar-outro]
#   (digite o e-mail e Enter; ou: printf '%s\n' "$EMAIL" | deploy/bootstrap-coordenacao.sh)
#
# - O e-mail entra SÓ por stdin: argumento apareceria em `ps` e no histórico do shell. Nada aqui
#   o imprime, e o SQL também segue por stdin.
# - O HMAC é calculado no container do APP (`email-hmac.mjs`, ao lado deste, via `node -e`, com a
#   BLIND_INDEX_KEY dele):
#   a chave não sai do app e o banco só recebe o resultado.
# - O psql roda DENTRO do container do banco como supabase_admin, sem -h e sem senha (socket local,
#   como em deploy/migra.sh).
# - A função SQL é idempotente e recusa se a raiz já tem gestor ativo, salvo --adicionar-outro.
# Saídas: 0 ok, 1 falha (nada concedido), 2 uso errado, 3 perfil bloqueado ou suspenso.
set -euo pipefail
umask 077

APP_CONTAINER=${APP_CONTAINER:-}
DB_CONTAINER=${DB_CONTAINER:-}
DB_USER=${DB_USER:-supabase_admin}
DB_NOME=${DB_NOME:-postgres}
OUTRO=false

# Checagem explícita, e NÃO `: "${VAR:?}"` (ver a nota do deploy/migra.sh sobre `set -e` e `trap`).
[ -n "$APP_CONTAINER" ] || { echo "falta APP_CONTAINER (container do app)" >&2; exit 2; }
[ -n "$DB_CONTAINER" ] || { echo "falta DB_CONTAINER (container do banco)" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --adicionar-outro) OUTRO=true; shift ;;
    *) echo "uso: bootstrap-coordenacao.sh [--adicionar-outro]  (e-mail por stdin)" >&2; exit 2 ;;
  esac
done

EMAIL=
IFS= read -r EMAIL || true
EMAIL=$(printf '%s' "$EMAIL" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
# Forma estrita, e sem aspas: o e-mail vai dentro de um literal SQL entre apóstrofos.
if ! printf '%s' "$EMAIL" | grep -Eq '^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$'; then
  echo "e-mail inválido" >&2; exit 2
fi

AQUI=$(cd "$(dirname "$0")" && pwd)
# O código do HMAC vai por `node -e` (a imagem do app não traz scripts do operador); o e-mail, por stdin.
HMAC=$(printf '%s\n' "$EMAIL" | docker exec -i "$APP_CONTAINER" node --input-type=module -e "$(cat "$AQUI/email-hmac.mjs")") \
  || { echo "falha ao calcular o HMAC no container do app" >&2; exit 1; }
printf '%s' "$HMAC" | grep -Eq '^[0-9a-f]{64}$' || { echo "HMAC fora do formato; nada foi enviado ao banco" >&2; exit 1; }

# SQL por stdin (printf é builtin: nada vai para a lista de processos).
RESP=$(printf "select app.bootstrap_root_manager('%s', '%s', %s);\n" "$HMAC" "$EMAIL" "$OUTRO" \
  | docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U "$DB_USER" -d "$DB_NOME" -At -f -) \
  || { echo "o banco recusou (nada concedido)" >&2; exit 1; }

ROLE=$(printf '%s' "$RESP" | sed -n 's/.*"role": *"\([a-z_]*\)".*/\1/p')
case "$ROLE" in
  granted)         echo "OK: papel de gestor da raiz concedido." ;;
  already)         echo "OK: a pessoa já era gestora da raiz." ;;
  waiting_profile) echo "OK: e-mail na lista. A pessoa ainda precisa entrar uma vez (login e perfil); depois rode o comando de novo." ;;
  waitlisted)      echo "AVISO: a conta está na espera, mas sem registro deste e-mail na fila (pode ter entrado por outro e-mail); nada concedido." >&2; exit 3 ;;
  not_active)      echo "AVISO: o perfil não está ativo (bloqueado ou suspenso); nada concedido." >&2; exit 3 ;;
  *)               echo "resposta inesperada do banco" >&2; exit 1 ;;
esac
echo "Conferência: o papel só vale depois de termo, perfil completo e casa aceita (docs/OPERACAO.md)."
