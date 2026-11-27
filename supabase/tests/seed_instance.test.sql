-- Seed da instância piloto (supabase/seed.sql, issue #46, ADR 0008 §2 e ADR 0011).
-- Confere a forma da árvore e que o seed não traz pessoa nem papel.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select is(
  (select path::text from public.units where parent_id is null),
  'br',
  'o seed cria a raiz nacional'
);
select set_eq(
  $$ select t.key from public.units u join public.unit_types t on t.id = u.type_id
     where extensions.nlevel(u.path) = 2 $$,
  array['state'],
  'abaixo da raiz ficam os estados'
);
select ok(
  not exists (
    select 1 from public.units u join public.unit_types t on t.id = u.type_id
    where t.key = 'state' and u.state_code is null
  ),
  'todo estado tem state_code (recebe quem se cadastra nele)'
);
select set_eq(
  $$ select distinct t.key from public.units u join public.unit_types t on t.id = u.type_id
     join public.units p on p.id = u.parent_id
     join public.unit_types pt on pt.id = p.type_id
     where pt.key = 'region' $$,
  array['team'],
  'abaixo das regiões ficam só equipes (a casa é nacional, fora da árvore; ADR 0011)'
);
select set_eq(
  $$ select key from public.houses where active $$,
  array['esparta', 'atenas', 'alexandria', 'siracusa'],
  'o seed cria as quatro casas nacionais, ativas (ADR 0011)'
);
select ok(
  not exists (select 1 from public.unit_types where key = 'house'),
  'não há mais tipo de unidade para a casa (ADR 0011)'
);
select ok(
  not exists (select 1 from public.unit_members)
  and not exists (select 1 from public.role_assignments),
  'o seed não cria vínculos nem papéis'
);

select * from finish();
rollback;
