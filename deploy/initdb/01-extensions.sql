-- Extensões exigidas pelo ADR 0005. Rodam uma vez, na criação do volume.
-- Os papéis (supabase_auth_admin, authenticator, anon, authenticated,
-- service_role) vêm das migrations da própria imagem supabase/postgres.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
