-- Habilidades (issue #8): catálogo provisório do seed local, busca por sinônimo e RLS de
-- `skills` e `profile_skills`. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------------------
-- Catálogo (supabase/seeds/skills_catalog.sql): 47 habilidades em 8 grupos
-- ---------------------------------------------------------------------------------------
select is((select count(*)::int from public.skills), 47, 'o seed traz as 47 habilidades do catálogo');
select is((select count(distinct category)::int from public.skills), 8, 'em 8 grupos');
select is(
  (select count(*)::int from public.skills where cardinality(aliases) = 0),
  0,
  'toda habilidade tem ao menos um sinônimo para a busca'
);
select results_eq(
  $$ select name from public.skills where aliases @> array['oratória'] $$,
  $$ values ('Falar em público') $$,
  'a busca por sinônimo acha a habilidade'
);
select throws_ok(
  $$ insert into public.skills (name, category) values ('Falar em público', 'Outro') $$,
  '23505', null,
  'o nome da habilidade é único'
);

-- ---------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.skills'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.profile_skills'::regclass),
  'skills e profile_skills têm RLS ligada'
);

-- e1 e e2: perfis ativos sem papel nenhum (um não está no escopo do outro); e3: na espera.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000e3');
insert into public.profiles (id, display_name_enc, municipality_code, status, access_status, consent_version)
select id, pg_temp.enc('n'), 3550308,
  case when id = '00000000-0000-0000-0000-0000000000e3' then 'pending' else 'active' end,
  case when id = '00000000-0000-0000-0000-0000000000e3' then 'waitlisted' else 'active' end,
  'termo-teste'
from auth.users where id::text like '00000000-0000-0000-0000-0000000000e%';
insert into public.profile_skills (profile_id, skill_id)
select p.id, (select id from public.skills where name = 'Fotografia')
from public.profiles as p where p.id::text like '00000000-0000-0000-0000-0000000000e%';

set local role authenticated;

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((select count(*)::int from public.skills), 47, 'perfil ativo lê o catálogo');
select results_eq(
  $$ select profile_id from public.profile_skills $$,
  $$ values ('00000000-0000-0000-0000-0000000000e1'::uuid) $$,
  'lê as próprias habilidades e não as de outro perfil fora do escopo'
);
select throws_ok(
  $$ insert into public.profile_skills (profile_id, skill_id)
     select '00000000-0000-0000-0000-0000000000e1', id from public.skills limit 1 $$,
  '42501', null,
  'a API não grava habilidade ainda (a gravação entra na #15)'
);
select throws_ok(
  $$ update public.skills set name = 'Outro nome' $$,
  '42501', null,
  'a API não altera o catálogo'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select is((select count(*)::int from public.skills), 0, 'quem está na espera não lê o catálogo');

set local role anon;
select throws_ok(
  $$ select count(*) from public.skills $$,
  '42501', null,
  'anônimo não lê o catálogo'
);

reset role;
select throws_ok(
  $$ delete from public.skills where name = 'Fotografia' $$,
  '23503', null,
  'uma habilidade em uso não é apagada (chave estrangeira)'
);

select * from finish();
rollback;
