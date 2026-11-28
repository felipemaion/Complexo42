-- Extensões exigidas pelo ADR 0005. Rodam uma vez, na criação do volume.
-- Os papéis (supabase_auth_admin, authenticator, anon, authenticated,
-- service_role) vêm das migrations da própria imagem supabase/postgres.
--
-- Todas no schema `extensions`: as funções do banco as chamam qualificadas e com `search_path = ''`
-- (`extensions.digest`, `extensions.hmac`, `extensions.ltree`). Sem `WITH SCHEMA`, a extensão cai em
-- `public` e o envio do questionário estoura (`42883`, staging de 2026-11-28). Conferido por
-- `tests/create-extension-schema.test.ts`.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
