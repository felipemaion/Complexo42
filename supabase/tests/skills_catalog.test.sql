-- Catálogo de habilidades (#25): só o gestor nacional cria, renomeia e desativa; desativar não
-- apaga os vínculos existentes. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

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

-- a1 gestor nacional | b1 gestor de SP (não é nacional)
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
delete from public.unit_members;
insert into public.role_assignments (profile_id, role, unit_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'manager', (select id from public.units where slug = 'br')),
  ('00000000-0000-0000-0000-0000000000b1', 'manager', (select id from public.units where slug = 'sp'));
insert into public.unit_members (unit_id, profile_id) values
  ((select id from public.units where slug = 'br'), '00000000-0000-0000-0000-0000000000a1'),
  ((select id from public.units where slug = 'sp'), '00000000-0000-0000-0000-0000000000b1');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.create_skill('Libras', 'Comunicação e oratória', array['língua de sinais']) $$,
  '42501', null, 'gestor estadual não mexe no catálogo (só o nacional)');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_config('t.s', public.create_skill(' Libras ', 'Comunicação e oratória', array['língua de sinais'])::text, true);
select is((select name || '|' || array_to_string(aliases, ',') from public.skills where id = current_setting('t.s')::uuid),
  'Libras|língua de sinais', 'o gestor nacional cria a habilidade com sinônimos (nome aparado)');
select throws_ok($$ select public.create_skill('Libras', 'Outra', null) $$, '23505', null, 'nome repetido é recusado');
select lives_ok($$ select public.update_skill(current_setting('t.s')::uuid, 'Libras (língua de sinais)', 'Comunicação e oratória', array['libras']) $$,
  'renomeia e troca os sinônimos');

-- Alguém marcou a habilidade; desativar não apaga o vínculo.
reset role;
insert into public.profile_skills (profile_id, skill_id) values ('00000000-0000-0000-0000-0000000000b1', current_setting('t.s')::uuid);
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.set_skill_active(current_setting('t.s')::uuid, false);
reset role;
select is((select active from public.skills where id = current_setting('t.s')::uuid), false, 'desativa a habilidade');
select is((select count(*)::int from public.profile_skills where skill_id = current_setting('t.s')::uuid), 1, 'desativar não apaga os vínculos existentes');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_skill_active(current_setting('t.s')::uuid, true) $$, '42501', null, 'gestor estadual não reativa');

select * from finish();
rollback;
