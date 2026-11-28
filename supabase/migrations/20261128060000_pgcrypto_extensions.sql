-- A pgcrypto precisa estar no schema `extensions` (issue do staging). As funções do banco chamam
-- `extensions.digest` e `extensions.hmac` com `search_path = ''` (`app.verify_server_signature`,
-- `public.resolve_house_analysis`, o aceite do resultado do questionário). No servidor a inicialização do
-- banco (`deploy/initdb/01-extensions.sql`, `CREATE EXTENSION pgcrypto` sem schema) a instalou em `public`, e
-- o envio do questionário estourava com `42883 function extensions.digest(bytea, unknown) does not exist`.
-- Nenhuma migration a criava: o banco local já a tem em `extensions`, e o CI passava só por isso.
--
-- `app.ensure_pgcrypto_in_extensions()` é idempotente, de qualquer estado de partida: sem a extensão, cria
-- em `extensions`; em outro schema, move; já em `extensions`, não faz nada. A pgcrypto é relocável, e mover
-- não perde nada: as funções ficam as mesmas. A migration a chama uma vez; fica na função, sem acesso da API
-- (só o dono do banco), para o teste exercitar o mesmo código que o servidor roda.
create schema if not exists extensions;

create or replace function app.ensure_pgcrypto_in_extensions()
returns text
language plpgsql
set search_path = ''
as $$
declare
  current_schema_name text;
begin
  select n.nspname into current_schema_name
  from pg_catalog.pg_extension as e
  join pg_catalog.pg_namespace as n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if current_schema_name is null then
    create extension pgcrypto with schema extensions;
  elsif current_schema_name <> 'extensions' then
    alter extension pgcrypto set schema extensions;
  end if;
  return 'extensions';
end;
$$;

comment on function app.ensure_pgcrypto_in_extensions() is
  'Só o dono do banco: garante a pgcrypto no schema extensions (cria ou move). Idempotente.';

revoke all on function app.ensure_pgcrypto_in_extensions() from public, anon, authenticated, service_role;

select app.ensure_pgcrypto_in_extensions();
