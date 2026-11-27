-- Novos tipos de medalha (#71, ADR 0007 §3): "evento" e "marco". O marco leva o nome de quem
-- conquistou primeiro (e a história); depois, todos que atingem ganham a mesma. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

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

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
delete from public.unit_members;
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'monitor', id from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values ('abc', '00000000-0000-0000-0000-0000000000c1'::uuid), ('team_x', '00000000-0000-0000-0000-0000000000a1'),
  ('team_x', '00000000-0000-0000-0000-0000000000a2')) as v (slug, p) join public.units as u on u.slug = v.slug;
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.create_special_badge(current_setting('t.abc')::uuid, 'Arrecadação', '', 'coracao', 'event') $$,
  '42501', null, 'membro sem papel não cria medalha de evento');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.create_special_badge(current_setting('t.abc')::uuid, 'Errada', '', 'estrela', 'attendance') $$,
  '22023', null, 'só evento e marco por aqui');
select set_config('t.ev', public.create_special_badge(current_setting('t.abc')::uuid, 'Arrecadação de agasalhos 2027', 'Participou da arrecadação', 'coracao', 'event')::text, true);
select set_config('t.ms', public.create_special_badge(current_setting('t.abc')::uuid, 'Primeiro corte com 10 mil visualizações', 'Marco de alcance', 'camera', 'milestone')::text, true);
select is((select rule_type from public.badges where id = current_setting('t.ev')::uuid), 'event', 'medalha de evento criada com o tipo certo');

select public.grant_badge(current_setting('t.ms')::uuid, '00000000-0000-0000-0000-0000000000a1', 'Corte do debate passou de 10 mil.');
select public.grant_badge(current_setting('t.ms')::uuid, '00000000-0000-0000-0000-0000000000a2', 'Também chegou lá.');
reset role;
select is((select named_after_profile_id from public.badges where id = current_setting('t.ms')::uuid), '00000000-0000-0000-0000-0000000000a1'::uuid,
  'o marco leva o nome de quem conquistou primeiro');
select is((select story from public.badges where id = current_setting('t.ms')::uuid), 'Corte do debate passou de 10 mil.',
  'a história do marco é o motivo da primeira conquista');
select is((select count(*)::int from public.profile_badges where badge_id = current_setting('t.ms')::uuid), 2,
  'depois, quem atinge o marco ganha a mesma medalha');

select * from finish();
rollback;
