#!/usr/bin/env bash
# O que o banco precisa saber do questionário (ADR 0014, issue #319): a versão do termo do arquivo
# instalado e a chave de assinatura do app. Antes só existia como SQL colado do docs/OPERACAO.md, e
# foi esse o passo que faltou no staging em 2026-11-28 (versão do termo ausente: ninguém respondia).
#
# Uso (no servidor, como operador, no diretório do deploy):
#   DB_CONTAINER=<container do banco> \
#     deploy/questionario-banco.sh <questionnaire.json> <arquivo-de-segredos>
#
# - A versão sai do `consentTermVersion` do JSON (o mesmo arquivo que o app lê), não de digitação.
# - A chave sai do arquivo de segredos e vai ao psql SÓ por stdin: nada em argumento (`ps`), nada
#   impresso. Upsert: rodar de novo com a mesma chave não muda nada; com outra, rotaciona.
# - O psql roda DENTRO do container do banco como supabase_admin, sem -h e sem senha (como o
#   deploy/migra.sh). Idempotente: rodar a cada JSON novo é o checklist do questionário.
# Saídas: 0 ok, 1 falha (o banco recusou: nada gravado), 2 uso errado ou entrada inválida.
set -euo pipefail
umask 077

DB_CONTAINER=${DB_CONTAINER:-}
DB_USER=${DB_USER:-supabase_admin}
DB_NOME=${DB_NOME:-postgres}

# Checagem explícita, e NÃO `: "${VAR:?}"` (ver a nota do deploy/migra.sh sobre `set -e` e `trap`).
[ -n "$DB_CONTAINER" ] || { echo "falta DB_CONTAINER (container do banco)" >&2; exit 2; }
[ $# -eq 2 ] || { echo "uso: questionario-banco.sh <questionnaire.json> <arquivo-de-segredos>" >&2; exit 2; }
QUESTIONARIO=$1; SEGREDOS=$2
[ -r "$QUESTIONARIO" ] || { echo "não consigo ler o questionário: $QUESTIONARIO" >&2; exit 2; }
[ -r "$SEGREDOS" ] || { echo "não consigo ler o arquivo de segredos" >&2; exit 2; }

VERSAO=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["consentTermVersion"])' "$QUESTIONARIO" 2>/dev/null) \
  || { echo "o questionário não tem consentTermVersion legível" >&2; exit 2; }
# Mesma forma que o banco aceita (docs/OPERACAO.md); e vai dentro de um literal SQL.
printf '%s' "$VERSAO" | grep -Eq '^[A-Za-z0-9._-]{1,32}$' || { echo "consentTermVersion fora do formato" >&2; exit 2; }

KEY=$(sed -n 's/^QUESTIONNAIRE_SIGNING_KEY=//p' "$SEGREDOS" | head -n1)
# Mínimo do banco: 32 caracteres. Base64 não tem apóstrofo, e é o que o gen-secrets.sh gera.
printf '%s' "$KEY" | grep -Eq '^[A-Za-z0-9+/=]{32,}$' \
  || { echo "QUESTIONNAIRE_SIGNING_KEY ausente, curta ou fora do formato no arquivo de segredos" >&2; exit 2; }

# Uma transação: ou as duas coisas entram, ou nenhuma. SQL por stdin (printf é builtin).
printf "begin;
insert into app.questionnaire_term_versions (version) values ('%s') on conflict do nothing;
insert into app.server_secrets (name, value) values ('questionnaire_signing_key', '%s')
  on conflict (name) do update set value = excluded.value;
commit;\n" "$VERSAO" "$KEY" \
  | docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U "$DB_USER" -d "$DB_NOME" -q -f - > /dev/null \
  || { echo "o banco recusou (nada gravado)" >&2; exit 1; }

echo "OK: versão do termo '$VERSAO' cadastrada e chave de assinatura instalada no banco."
