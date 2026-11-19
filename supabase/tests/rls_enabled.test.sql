-- Guarda da R5: nenhuma tabela em `public` ou `app` pode existir sem RLS.
-- Se este teste falhar, a mensagem lista as tabelas culpadas: habilite RLS na migration
-- (`alter table ... enable row level security;`) e crie a política com teste.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

-- O guarda propriamente dito: o estado real do banco depois de todas as migrations.
select is_empty(
  $$ select format('%I.%I', schema_name, table_name) from app.tables_without_rls() $$,
  'toda tabela em public e app tem RLS habilitada'
);

-- Prova de que o guarda detecta o problema: tabela sem RLS criada só nesta transação.
create table public.rls_guard_probe (id int primary key);
create table app.rls_guard_probe (id int primary key);

select set_eq(
  $$ select format('%I.%I', schema_name, table_name) from app.tables_without_rls() $$,
  array['app.rls_guard_probe', 'public.rls_guard_probe'],
  'tabelas sem RLS em public e app são apontadas'
);

-- Outros schemas não entram na checagem padrão, mas podem ser pedidos explicitamente.
create schema rls_guard_other;
create table rls_guard_other.probe (id int);
select ok(
  not exists (
    select 1 from app.tables_without_rls() where schema_name = 'rls_guard_other'
  ),
  'schemas fora da lista padrão são ignorados'
);
select set_eq(
  $$ select format('%I.%I', schema_name, table_name)
     from app.tables_without_rls(array['rls_guard_other']) $$,
  array['rls_guard_other.probe'],
  'a lista de schemas é configurável'
);

-- Habilitar RLS tira a tabela da lista.
alter table public.rls_guard_probe enable row level security;
alter table app.rls_guard_probe enable row level security;
select is_empty(
  $$ select format('%I.%I', schema_name, table_name) from app.tables_without_rls() $$,
  'com RLS habilitada as tabelas deixam de ser apontadas'
);

select * from finish();
rollback;
