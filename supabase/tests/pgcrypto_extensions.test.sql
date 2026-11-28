-- pgcrypto no schema `extensions` (issue do staging): as funções do banco chamam `extensions.digest` e
-- `extensions.hmac` com `search_path = ''`. No servidor a inicialização do banco instalou a pgcrypto em
-- `public`, e o envio do questionário estourava com `42883 function extensions.digest(bytea, unknown) does
-- not exist`. A migration garante a extensão em `extensions`, de qualquer estado de partida.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.pgcrypto_schema() returns text language sql as $$
  select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto'
$$;

-- Estado atual (migrations aplicadas)
select is(pg_temp.pgcrypto_schema(), 'extensions', 'a pgcrypto fica no schema extensions');
select has_function('extensions', 'digest', array['bytea', 'text'], 'extensions.digest(bytea, text) existe');
select has_function('extensions', 'hmac', array['bytea', 'bytea', 'text'], 'extensions.hmac(bytea, bytea, text) existe');
select is(
  encode(extensions.digest('abc'::bytea, 'sha256'), 'hex'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'digest resolve e calcula (vetor de teste do SHA-256)');
set local search_path = '';
select lives_ok(
  $$ select extensions.digest('a'::bytea, 'sha256'), extensions.hmac('a'::bytea, 'k'::bytea, 'sha256') $$,
  'resolvem com search_path vazio, como nas funções do banco');
reset search_path;

-- Simula o servidor: a pgcrypto em `public`. A migration a traz para `extensions`.
alter extension pgcrypto set schema public;
select is(pg_temp.pgcrypto_schema(), 'public', 'partida: a pgcrypto está em public (como no servidor)');
\ir ../migrations/20261128060000_pgcrypto_extensions.sql
select is(pg_temp.pgcrypto_schema(), 'extensions', 'a migration move a pgcrypto de public para extensions');

-- Idempotente: rodar de novo não muda nem falha.
\ir ../migrations/20261128060000_pgcrypto_extensions.sql
select is(pg_temp.pgcrypto_schema(), 'extensions', 'rodar de novo mantém em extensions');

-- Sem a extensão: a migration a cria direto em extensions.
drop extension pgcrypto;
select is(pg_temp.pgcrypto_schema(), null, 'partida: sem pgcrypto');
\ir ../migrations/20261128060000_pgcrypto_extensions.sql
select is(pg_temp.pgcrypto_schema(), 'extensions', 'sem a extensão, a migration a cria em extensions');

select * from finish();
rollback;
