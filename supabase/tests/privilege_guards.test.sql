-- Guardas de privilégio (#68), no mesmo espírito do guarda de RLS (R5), mas para o que a RLS
-- não cobre. Valem para toda migration futura, não só para o que já existe:
--   1. toda função `security definer` fixa o `search_path` (sem isso, um schema que o usuário
--      controla pode sequestrar a função, que roda com o privilégio do dono);
--   2. `anon` (visitante sem login) só executa funções de uma lista explícita e curta;
--   3. `anon` não tem nenhum privilégio de tabela em `public` ou `app`.
-- Falhou? A mensagem lista os culpados. Corrija a migration; só amplie a lista da guarda 2
-- quando a função for pública de propósito, e diga o porquê no PR.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- Guarda 1: funções definer sem search_path fixo.
create function pg_temp.definer_without_search_path() returns setof text
language sql stable as $$
  select format('%I.%I', n.nspname, p.proname)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
    and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) as setting
      where setting like 'search_path=%'
    )
$$;

select is_empty(
  $$ select * from pg_temp.definer_without_search_path() $$,
  'toda função security definer fixa o search_path'
);

-- Prova de que a guarda enxerga o problema.
create function public.definer_guard_probe() returns int
language sql security definer as $$ select 1 $$;
revoke execute on function public.definer_guard_probe() from public, anon; -- não vazar para a guarda 2
select set_eq(
  $$ select * from pg_temp.definer_without_search_path() $$,
  array['public.definer_guard_probe'],
  'definer sem search_path é apontada'
);
alter function public.definer_guard_probe() set search_path = '';
select is_empty(
  $$ select * from pg_temp.definer_without_search_path() $$,
  'com search_path fixo a função deixa de ser apontada'
);

-- Guarda 2: funções que o visitante sem login pode executar.
create function pg_temp.functions_open_to_anon() returns setof text
language sql stable as $$
  select format('%I.%I', n.nspname, p.proname)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
    and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
$$;

select set_eq(
  $$ select * from pg_temp.functions_open_to_anon() $$,
  array['app.is_encrypted_value'],
  'anon só executa as funções da lista (hoje: o validador de valor cifrado, usado em CHECK)'
);

-- Prova: função nova com o EXECUTE padrão do Postgres (PUBLIC) aparece na lista.
create function public.anon_guard_probe() returns int language sql as $$ select 1 $$;
select ok(
  'public.anon_guard_probe' in (select * from pg_temp.functions_open_to_anon()),
  'função nova com EXECUTE para PUBLIC é apontada'
);
revoke execute on function public.anon_guard_probe() from public, anon;
select ok(
  'public.anon_guard_probe' not in (select * from pg_temp.functions_open_to_anon()),
  'sem EXECUTE para anon a função deixa de ser apontada'
);

-- Guarda 3: tabelas com privilégio para anon.
create function pg_temp.tables_open_to_anon() returns setof text
language sql stable as $$
  select distinct format('%I.%I', table_schema, table_name)
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema in ('public', 'app')
$$;

select is_empty(
  $$ select * from pg_temp.tables_open_to_anon() $$,
  'anon não tem privilégio em nenhuma tabela de public ou app'
);

create table public.anon_table_probe (id int);
grant select on public.anon_table_probe to anon;
select set_eq(
  $$ select * from pg_temp.tables_open_to_anon() $$,
  array['public.anon_table_probe'],
  'tabela com grant para anon é apontada'
);

select * from finish();
rollback;
