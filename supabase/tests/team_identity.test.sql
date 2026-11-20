-- Identidade da turma (#56, ADR 0006 §2): lema, 2–3 cores e emblema do catálogo. Só quem coordena
-- a turma ou a coordenação do escopo edita; quem é da turma (ou do escopo) vê. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

truncate public.role_assignments, public.unit_members, public.house_members, public.units cascade;
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
select pg_temp.add_unit('region', 'sp', 'zl');

-- c1 monitor ABC | c9 monitor ZL (fora) | b1 líder da equipe X | a1 membro da X
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c9'),
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000a1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'monitor', (select id from public.units where slug = 'abc')),
  ('00000000-0000-0000-0000-0000000000c9', 'monitor', (select id from public.units where slug = 'zl'));
insert into public.unit_members (unit_id, profile_id, member_role)
select u.id, v.p, v.r from (values
  ('abc', '00000000-0000-0000-0000-0000000000c1'::uuid, 'member'),
  ('zl', '00000000-0000-0000-0000-0000000000c9'::uuid, 'member'),
  ('team_x', '00000000-0000-0000-0000-0000000000b1'::uuid, 'lead'),
  ('team_x', '00000000-0000-0000-0000-0000000000a1'::uuid, 'member')
) as v (slug, p, r) join public.units as u on u.slug = v.slug;
select set_config('t.team', (select id::text from public.units where slug = 'team_x'), true);

set local role authenticated;

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, 'Juntos pelo bairro', array['#1f4e79','#f2a900'], 'tocha') $$,
  '42501', null, 'quem só é membro da turma não edita a identidade');

select pg_temp.login('00000000-0000-0000-0000-0000000000c9');
select throws_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, 'Juntos pelo bairro', array['#1f4e79','#f2a900'], 'tocha') $$,
  '42501', null, 'coordenação de outra região não edita (fora do escopo → negado)');
select is((select count(*)::int from public.team_identity(current_setting('t.team')::uuid)), 0,
  'coordenação de outra região não vê a identidade');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, 'ok', array['#1f4e79'], 'tocha') $$,
  '22023', null, 'uma cor só é recusada (são 2 ou 3)');
select throws_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, 'ok', array['#1f4e79','vermelho'], 'tocha') $$,
  '22023', null, 'cor fora do formato #RRGGBB é recusada');
select throws_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, repeat('a', 81), array['#1f4e79','#f2a900'], 'tocha') $$,
  '22023', null, 'lema com mais de 80 letras é recusado');
select throws_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, 'ok', array['#1f4e79','#f2a900'], 'caveira') $$,
  '22023', null, 'emblema fora do catálogo é recusado');
select lives_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, '  Juntos pelo bairro  ', array['#1F4E79','#f2a900','#ffffff'], 'tocha') $$,
  'quem coordena a turma define lema, cores e emblema');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select motto || '|' || array_to_string(colors, ',') || '|' || emblem from public.team_identity(current_setting('t.team')::uuid)),
  'Juntos pelo bairro|#1f4e79,#f2a900,#ffffff|tocha', 'quem é da turma vê a identidade (lema aparado, cores em minúsculas)');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.set_team_identity(current_setting('t.team')::uuid, 'Lema novo', array['#000000','#d4a537'], 'escudo') $$,
  'coordenação da região também edita');
select is((select emblem from public.team_identity(current_setting('t.team')::uuid)), 'escudo', 'a edição da coordenação vale');

select * from finish();
rollback;
