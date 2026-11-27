-- Montagem de equipes do 1º ciclo (ata de 17/11; #28 e #29): quem coordena a região cria a
-- equipe, distribui as pessoas e escolhe o coordenador da equipe. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

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
select pg_temp.add_unit('region', 'sp', 'leste');

-- c1 monitor da região ABC | c2 monitor da região Leste | d1, d2 pessoas da região ABC sem equipe
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'monitor', id from public.units where slug = 'abc';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c2', 'monitor', id from public.units where slug = 'leste';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('abc', '00000000-0000-0000-0000-0000000000d1'::uuid), ('abc', '00000000-0000-0000-0000-0000000000d2')
) as v (slug, p) join public.units as u on u.slug = v.slug;
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);

set local role anon;
select throws_ok($$ select public.create_team(current_setting('t.abc')::uuid, 'Equipe 7') $$, '42501', null,
  'sem login, ninguém cria equipe');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.create_team(current_setting('t.abc')::uuid, 'Equipe 7') $$, '42501', null,
  'membro sem papel não cria equipe');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select ok((select bool_or(id = current_setting('t.abc')::uuid) from public.team_parents()),
  'a região do coordenador aparece como lugar para criar equipe');
select set_config('t.team', public.create_team(current_setting('t.abc')::uuid, '  Equipe 7  ')::text, true);
select is((select name from public.my_teams() where id = current_setting('t.team')::uuid), 'Equipe 7',
  'coordenador cria a equipe na própria região (nome sem espaços nas pontas)');
select set_eq($$ select profile_id from public.unassigned_people(current_setting('t.abc')::uuid) $$,
  $$ values ('00000000-0000-0000-0000-0000000000d1'::uuid), ('00000000-0000-0000-0000-0000000000d2') $$,
  'quem está na região sem equipe aparece para distribuir');

select public.assign_to_team('00000000-0000-0000-0000-0000000000d1', current_setting('t.team')::uuid);
select is((select member_count from public.my_teams() where id = current_setting('t.team')::uuid), 1,
  'pessoa colocada na equipe');
select public.set_team_lead(current_setting('t.team')::uuid, '00000000-0000-0000-0000-0000000000d1');
select is((select is_lead from public.team_members(current_setting('t.team')::uuid) limit 1), true,
  'coordenador da equipe definido e listado primeiro');
select throws_ok($$ select public.remove_from_team('00000000-0000-0000-0000-0000000000d2', current_setting('t.team')::uuid) $$,
  '42501', null, 'não dá para "tirar da equipe" quem não está nela (nem movê-la por esse caminho)');

select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$ select public.assign_to_team('00000000-0000-0000-0000-0000000000d2', current_setting('t.team')::uuid) $$,
  '42501', null, 'coordenador de outra região não mexe nesta equipe (fora do escopo → negado)');
select is_empty($$ select * from public.team_members(current_setting('t.team')::uuid) $$,
  'coordenador de outra região não vê os membros');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.remove_from_team('00000000-0000-0000-0000-0000000000d1', current_setting('t.team')::uuid);
select is((select member_count from public.my_teams() where id = current_setting('t.team')::uuid), 0,
  'tirar da equipe esvazia a equipe');
reset role;
select is((select unit_id::text from public.unit_members
           where profile_id = '00000000-0000-0000-0000-0000000000d1' and left_at is null),
  current_setting('t.abc'), 'quem sai da equipe volta para a região');

select * from finish();
rollback;
