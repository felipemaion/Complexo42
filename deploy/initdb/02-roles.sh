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

# Uma senha por papel (#95). Falha ja aqui se faltar alguma: melhor o volume
# nao nascer do que nascer com papel sem senha ou com a senha errada.
: "${AUTHENTICATOR_PASSWORD:?falta AUTHENTICATOR_PASSWORD no ambiente do db}"
: "${AUTH_ADMIN_PASSWORD:?falta AUTH_ADMIN_PASSWORD no ambiente do db}"

# Papéis sem senha primeiro: se algo aqui falhar, a mensagem de erro não
# carrega credencial para o log do container.
psql -v ON_ERROR_STOP=1 --username "$SUPER" --dbname "$BANCO" <<'SQL'
-- As migrations do GoTrue fazem `grant ... to postgres`, e esta imagem NAO
-- cria esse papel (so o supabase_admin). Sem ele, a migration
-- 20240612123726_enable_rls_update_grants falha com
-- 'role "postgres" does not exist' e o auth nao sobe. Medido em 2026-11-19.
--
-- NOLOGIN e DEFINITIVO (#95): as migrations precisam que o papel EXISTA, nao
-- que ele se conecte. O job de migrations (#81) entra como supabase_admin, com
-- a POSTGRES_PASSWORD. Se algum dia um job precisar conectar como `postgres`,
-- o certo e dar a ele uma senha PROPRIA -- ver "Senhas por papel" em
-- docs/OPERACAO.md --, nunca reaproveitar a do superusuario.
CREATE ROLE postgres SUPERUSER CREATEDB CREATEROLE NOLOGIN;

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

# Só agora as senhas, em statements separados e mínimos. Cada papel recebe a
# SUA senha: a do superusuário (POSTGRES_PASSWORD, que a imagem já aplicou ao
# supabase_admin) não aparece aqui de propósito.
psql -v ON_ERROR_STOP=1 --username "$SUPER" --dbname "$BANCO" \
     -v autenticador="$AUTHENTICATOR_PASSWORD" \
     -v admin_auth="$AUTH_ADMIN_PASSWORD" <<'SQL'
ALTER ROLE authenticator       WITH LOGIN PASSWORD :'autenticador';
ALTER ROLE supabase_auth_admin WITH LOGIN PASSWORD :'admin_auth';
SQL

echo "papeis criados: postgres (NOLOGIN), anon, authenticated, service_role, authenticator, supabase_auth_admin"
echo "senhas: uma por papel (#95); o superusuario nao foi compartilhado"
