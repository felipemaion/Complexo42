-- pgcrypto no schema `extensions` (issue do staging): as funções do banco chamam `extensions.digest` e
-- `extensions.hmac` com `search_path = ''`. No servidor a inicialização do banco instalou a pgcrypto em
-- `public`, e o envio do questionário estourava com `42883 function extensions.digest(bytea, unknown) does
-- not exist`. A migration garante a extensão em `extensions`, de qualquer estado de partida.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

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
-- Como as funções do banco: `search_path` vazio, tudo qualificado.
create function pg_temp.sem_search_path() returns text
language plpgsql set search_path = '' as $$
begin
  return encode(extensions.digest('a'::bytea, 'sha256'), 'hex') || '|' || length(extensions.hmac('a'::bytea, 'k'::bytea, 'sha256'))::text;
end;
$$;
select is(
  pg_temp.sem_search_path(),
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb|32',
  'digest e hmac resolvem com search_path vazio, como nas funções do banco');

-- Simula o servidor: a pgcrypto em `public`. A migration a traz para `extensions`.
alter extension pgcrypto set schema public;
select is(pg_temp.pgcrypto_schema(), 'public', 'partida: a pgcrypto está em public (como no servidor)');
select app.ensure_pgcrypto_in_extensions();
select is(pg_temp.pgcrypto_schema(), 'extensions', 'a migration move a pgcrypto de public para extensions');

-- Idempotente: rodar de novo não muda nem falha.
select app.ensure_pgcrypto_in_extensions();
select is(pg_temp.pgcrypto_schema(), 'extensions', 'rodar de novo mantém em extensions');

-- Sem a extensão: a migration a cria direto em extensions.
drop extension pgcrypto;
select is(pg_temp.pgcrypto_schema(), null, 'partida: sem pgcrypto');
select app.ensure_pgcrypto_in_extensions();
select is(pg_temp.pgcrypto_schema(), 'extensions', 'sem a extensão, a migration a cria em extensions');

-- Só o dono do banco chama (a API não).
select ok(not has_function_privilege('authenticated', 'app.ensure_pgcrypto_in_extensions()', 'execute'), 'authenticated não executa');
select ok(not has_function_privilege('service_role', 'app.ensure_pgcrypto_in_extensions()', 'execute'), 'service_role não executa');

select * from finish();
rollback;
