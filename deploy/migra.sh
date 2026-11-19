#!/usr/bin/env bash
# Aplica as migrations pendentes antes de trocar o app (issue #81, ADR 0009 §3).
# Chamado pelo deploy.sh como $MIGRA, com APP_TAG no ambiente. Sai != 0 em
# qualquer falha, e é isso que faz o deploy abortar com o app intacto.
#
# As migrations vêm DA IMAGEM da tag, não de um checkout no servidor: o deploy
# recebe só a tag, e o schema tem de ser o que veio com ela.
#
# O psql roda DENTRO do container do banco (`docker exec`), não num container
# com rede: assim a senha do Postgres não atravessa lugar nenhum -- conexão
# local dentro do container é confiável. É uma troca consciente em relação ao
# "container de uso único" da issue; o isolamento que importa (abortar sem
# tocar o app) continua valendo.
set -euo pipefail
umask 077

: "${APP_TAG:?falta APP_TAG}"
: "${IMAGEM:?falta IMAGEM}"
: "${DB_CONTAINER:?falta DB_CONTAINER (container do banco do ambiente)}"
DB_USER=${DB_USER:-supabase_admin}
DB_NOME=${DB_NOME:-postgres}

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
psqlc() { docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NOME" -v ON_ERROR_STOP=1 "$@"; }

TMP=$(mktemp -d)
CRIADO=
limpar() {
  [ -n "$CRIADO" ] && docker rm -f "$CRIADO" > /dev/null 2>&1
  [ -n "$TMP" ] && rm -rf -- "$TMP"
  return 0
}
trap limpar EXIT

# ── de onde saem as migrations: da imagem da tag ──
CRIADO=migra-$$
docker create --name "$CRIADO" "$IMAGEM:$APP_TAG" > /dev/null
docker cp "$CRIADO:/app/supabase/migrations" "$TMP/migrations"
docker rm -f "$CRIADO" > /dev/null; CRIADO=

NA_IMAGEM=$(ls -1 "$TMP/migrations"/*.sql 2> /dev/null | wc -l | tr -d ' ')
[ "$NA_IMAGEM" -gt 0 ] || { log "ERRO: a imagem $APP_TAG nao traz migrations"; exit 1; }
log "migrations na imagem: $NA_IMAGEM"

# ── tabela de controle: a mesma do CLI do Supabase ──
psqlc -q -c "create schema if not exists supabase_migrations;
             create table if not exists supabase_migrations.schema_migrations (
               version text primary key, inserted_at timestamptz not null default now());"

APLICADAS=$(psqlc -At -c "select version from supabase_migrations.schema_migrations;")
aplicada() {
  local v=$1 a
  for a in $APLICADAS; do [ "$a" = "$v" ] && return 0; done
  return 1
}

PENDENTES=0 FEITAS=0
for f in $(ls -1 "$TMP/migrations"/*.sql | sort); do
  base=$(basename "$f"); versao=${base%%_*}
  aplicada "$versao" && continue
  PENDENTES=$((PENDENTES + 1))
  log "aplicando $base"
  # Uma transação por migration: falhou, nada DELA fica, e as anteriores que
  # passaram continuam valendo. Sem isto, uma falha no meio deixa o schema
  # num estado que nenhum arquivo descreve.
  if ! { printf 'begin;\n'; cat "$f"
         printf "\ninsert into supabase_migrations.schema_migrations(version) values ('%s');\ncommit;\n" "$versao"
       } | psqlc -q; then
    log "ERRO: $base falhou -- nada dela foi gravado"
    exit 1
  fi
  FEITAS=$((FEITAS + 1))
done

[ "$PENDENTES" = 0 ] && log "nada pendente" || log "aplicadas $FEITAS de $PENDENTES"
exit 0
