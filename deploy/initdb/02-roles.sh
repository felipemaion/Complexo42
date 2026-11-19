#!/bin/bash
# Papéis que o Supabase espera. MEDIDO em 2026-11-19: a imagem
# supabase/postgres cria apenas o `supabase_admin` — `anon`, `authenticated`,
# `service_role`, `authenticator` e `supabase_auth_admin` fazem parte do
# bootstrap do self-host, NÃO da imagem. Sem isto, o GoTrue e o PostgREST
# sobem e morrem sem conseguir autenticar no banco.
#
# Roda uma vez, na criação do volume, como o superusuário da inicialização.
set -euo pipefail

SUPER=${POSTGRES_USER:-supabase_admin}
BANCO=${POSTGRES_DB:-postgres}

# Papéis sem senha primeiro: se algo aqui falhar, a mensagem de erro não
# carrega credencial para o log do container.
psql -v ON_ERROR_STOP=1 --username "$SUPER" --dbname "$BANCO" <<'SQL'
CREATE ROLE anon          NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOLOGIN NOINHERIT;
CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT CREATEROLE;

GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = 'auth';

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon, authenticated, service_role;
SQL

# Só agora as senhas, em statements separados e mínimos.
psql -v ON_ERROR_STOP=1 --username "$SUPER" --dbname "$BANCO" \
     -v senha="$POSTGRES_PASSWORD" <<'SQL'
ALTER ROLE authenticator       WITH LOGIN PASSWORD :'senha';
ALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD :'senha';
SQL

echo "papeis criados: anon, authenticated, service_role, authenticator, supabase_auth_admin"
