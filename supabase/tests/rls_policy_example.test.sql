-- Exemplo de teste de política (R5): "usuário A não lê dado do usuário B".
-- Modelo para as tabelas reais: copie a estrutura (dados de dois usuários, troca de papel
-- e de JWT com `set local`, asserções do caminho feliz e do acesso negado).
-- A tabela existe só dentro desta transação; nada fica no banco.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create table public.rls_example_notes (
  id int generated always as identity primary key,
  owner_id uuid not null default auth.uid(),
  body text not null
);
alter table public.rls_example_notes enable row level security;

create policy rls_example_notes_owner_select on public.rls_example_notes
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy rls_example_notes_owner_insert on public.rls_example_notes
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

grant select, insert on public.rls_example_notes to anon, authenticated;

-- Dados fictícios, inseridos como dono do banco (ignora RLS).
insert into public.rls_example_notes (owner_id, body) values
  ('00000000-0000-0000-0000-00000000000a', 'nota do usuário A'),
  ('00000000-0000-0000-0000-00000000000b', 'nota do usuário B');

-- Usuário A autenticado.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select results_eq(
  $$ select body from public.rls_example_notes $$,
  array['nota do usuário A'],
  'usuário A lê a própria nota'
);
select is_empty(
  $$ select 1 from public.rls_example_notes
     where owner_id = '00000000-0000-0000-0000-00000000000b' $$,
  'usuário A não lê a nota do usuário B'
);
select lives_ok(
  $$ insert into public.rls_example_notes (body) values ('outra nota do A') $$,
  'usuário A grava nota em seu nome'
);
select throws_ok(
  $$ insert into public.rls_example_notes (owner_id, body)
     values ('00000000-0000-0000-0000-00000000000b', 'nota forjada') $$,
  '42501',
  null,
  'usuário A não grava nota em nome do usuário B'
);

-- Usuário B autenticado.
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';

select results_eq(
  $$ select body from public.rls_example_notes $$,
  array['nota do usuário B'],
  'usuário B lê só a própria nota'
);

-- Visitante sem login: nenhuma política para anon, logo nada é visível nem gravável.
reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select is_empty(
  $$ select 1 from public.rls_example_notes $$,
  'visitante anônimo não lê nenhuma nota'
);
select throws_ok(
  $$ insert into public.rls_example_notes (owner_id, body)
     values ('00000000-0000-0000-0000-00000000000a', 'nota anônima') $$,
  '42501',
  null,
  'visitante anônimo não grava nota'
);

reset role;
select is(
  (select count(*)::int from public.rls_example_notes),
  3,
  'só a nota legítima do usuário A foi gravada'
);

select * from finish();
rollback;
