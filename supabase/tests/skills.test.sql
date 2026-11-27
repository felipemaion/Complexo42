-- Habilidades (issue #8): catálogo provisório do seed local, busca por sinônimo e RLS de
-- `skills` e `profile_skills`. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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
-- RLS (modelo de contact_visibility.test.sql)
-- ---------------------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.skills'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.profile_skills'::regclass),
  'skills e profile_skills têm RLS ligada'
);

-- Árvore: br ─ sp (SP) ─ abc ─┬─ team_x
--                             └─ team_y
-- Casa nacional casa-x, fora da árvore (ADR 0011).
truncate public.questionnaire_data_grants, public.role_assignments, public.unit_members, public.house_members, public.units;
create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns void language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, (select u.id from public.units as u where u.slug = p_parent), p_slug, p_slug,
         p_state, p_slug::extensions.ltree
  from public.unit_types as t where t.key = p_type
$$;
select pg_temp.add_unit('national', null, 'br');
select pg_temp.add_unit('state', 'br', 'sp', 'SP');
select pg_temp.add_unit('region', 'sp', 'abc');
select pg_temp.add_unit('team', 'abc', 'team_x');
select pg_temp.add_unit('team', 'abc', 'team_y');
insert into public.houses (key) values ('casa-x') on conflict do nothing;

-- Pessoas (todas com a habilidade Fotografia):
--   c1 monitor da equipe X        c2 manager da equipe X     c3 coordenador da casa X no ABC
--   m1 equipe X + casa X (8 dias) m2 equipe X, conta suspensa
--   o1 equipe Y, sem papel (fora do escopo de todos)
--   w1 na espera, com papel de monitor na equipe X (o papel não vale sem estar ativo)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3'), ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d2'), ('00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000f2');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users;
-- Membro de verdade exige o termo vigente aceito (is_active_member, revisão do #227): quem tem perfil aceitou o termo.
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active';
update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-0000000000d2';
update public.profiles set access_status = 'waitlisted' where id = '00000000-0000-0000-0000-0000000000f2';

insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'monitor', id from public.units where slug = 'team_x';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c2', 'manager', id from public.units where slug = 'team_x';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000f2', 'monitor', id from public.units where slug = 'team_x';
insert into public.role_assignments (profile_id, role, unit_id, house_key)
select '00000000-0000-0000-0000-0000000000c3', 'house_coordinator', id, 'casa-x'
from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.profile_id
from (values
  ('team_x', '00000000-0000-0000-0000-0000000000c1'::uuid),
  ('team_x', '00000000-0000-0000-0000-0000000000c2'),
  ('team_x', '00000000-0000-0000-0000-0000000000d1'),
  ('team_x', '00000000-0000-0000-0000-0000000000d2'),
  ('team_x', '00000000-0000-0000-0000-0000000000f2'),
  ('team_y', '00000000-0000-0000-0000-0000000000f1')
) as v (slug, profile_id) join public.units as u on u.slug = v.slug;
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'casa-x', 'self', now() - interval '8 days', now() - interval '8 days'),
  ('00000000-0000-0000-0000-0000000000d2', 'casa-x', 'self', now() - interval '8 days', now() - interval '8 days');

insert into public.profile_skills (profile_id, skill_id)
select p.id, (select id from public.skills where name = 'Fotografia') from public.profiles as p;

set local role authenticated;

-- Quem tem o perfil no escopo lê as habilidades dele.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select set_eq(
  $$ select profile_id from public.profile_skills $$,
  $$ values ('00000000-0000-0000-0000-0000000000c1'::uuid), ('00000000-0000-0000-0000-0000000000c2'),
            ('00000000-0000-0000-0000-0000000000d1') $$,
  'monitor da equipe lê as próprias e as de quem está ativo na equipe (não as da outra equipe, da suspensa nem da espera)'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select set_eq(
  $$ select profile_id from public.profile_skills $$,
  $$ values ('00000000-0000-0000-0000-0000000000c1'::uuid), ('00000000-0000-0000-0000-0000000000c2'),
            ('00000000-0000-0000-0000-0000000000d1') $$,
  'gestor da equipe lê as próprias e as de quem está ativo na equipe'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select set_eq(
  $$ select profile_id from public.profile_skills $$,
  $$ values ('00000000-0000-0000-0000-0000000000c3'::uuid), ('00000000-0000-0000-0000-0000000000d1') $$,
  'coordenador da casa lê as dos membros da casa no território, e só deles'
);

-- Fora do escopo: só as próprias.
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select results_eq(
  $$ select profile_id from public.profile_skills $$,
  $$ values ('00000000-0000-0000-0000-0000000000f1'::uuid) $$,
  'quem está fora do escopo lê só as próprias habilidades'
);

-- Membro inativo: nenhum coordenador lê.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is_empty(
  $$ select 1 from public.profile_skills where profile_id = '00000000-0000-0000-0000-0000000000d2' $$,
  'coordenador ativo não lê as habilidades de membro inativo'
);

-- Em espera: o papel não vale, só vê a si mesmo.
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select results_eq(
  $$ select profile_id from public.profile_skills $$,
  $$ values ('00000000-0000-0000-0000-0000000000f2'::uuid) $$,
  'quem está em espera vê, em profile_skills, só a si mesmo'
);
select is((select count(*)::int from public.skills), 0, 'quem está em espera não lê o catálogo');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.skills), 47, 'perfil ativo lê o catálogo');

-- Escrita: nada pela API.
select throws_ok(
  $$ insert into public.profile_skills (profile_id, skill_id)
     select '00000000-0000-0000-0000-0000000000c1', id from public.skills where name = 'Debate' $$,
  '42501', null, 'authenticated não insere em profile_skills (a gravação entra na #15)'
);
select throws_ok(
  $$ delete from public.profile_skills $$,
  '42501', null, 'authenticated não apaga de profile_skills'
);
select throws_ok(
  $$ insert into public.skills (name, category) values ('Nova', 'Outro') $$,
  '42501', null, 'authenticated não insere no catálogo'
);
select throws_ok(
  $$ update public.skills set name = 'Outro nome' $$,
  '42501', null, 'authenticated não altera o catálogo'
);
select throws_ok(
  $$ delete from public.skills $$,
  '42501', null, 'authenticated não apaga do catálogo'
);

set local role anon;
select throws_ok(
  $$ select count(*) from public.skills $$,
  '42501', null, 'anônimo não lê o catálogo'
);
select throws_ok(
  $$ select count(*) from public.profile_skills $$,
  '42501', null, 'anônimo não lê profile_skills'
);

reset role;
select throws_ok(
  $$ delete from public.skills where name = 'Fotografia' $$,
  '23503', null, 'uma habilidade em uso não é apagada (chave estrangeira)'
);

select * from finish();
rollback;
