-- Delegar papéis pela tela (#22, ADR 0002): a coordenação concede monitor, porta-voz ou coordenação
-- só abaixo do próprio escopo, nunca a si mesma, e só a quem está na unidade; revoga o que pode.
-- Toda concessão e revogação vai para o audit_log. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

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

-- c1 coordena (manager) a ABC | a1 membro da equipe X | f1 membro da ZL
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000f1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'manager', id from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values ('abc', '00000000-0000-0000-0000-0000000000c1'::uuid), ('team_x', '00000000-0000-0000-0000-0000000000a1'),
  ('zl', '00000000-0000-0000-0000-0000000000f1')) as v (slug, p) join public.units as u on u.slug = v.slug;
select set_config('t.x', (select id::text from public.units where slug = 'team_x'), true);
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.grant_role('00000000-0000-0000-0000-0000000000f1', 'monitor', current_setting('t.x')::uuid) $$,
  '42501', null, 'quem não coordena não concede papel');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.grant_role('00000000-0000-0000-0000-0000000000c1', 'monitor', current_setting('t.x')::uuid) $$,
  '42501', null, 'ninguém concede papel a si mesmo');
select throws_ok($$ select public.grant_role('00000000-0000-0000-0000-0000000000a1', 'monitor', current_setting('t.abc')::uuid) $$,
  '42501', null, 'não concede no mesmo nível (só para baixo)');
select throws_ok($$ select public.grant_role('00000000-0000-0000-0000-0000000000f1', 'monitor', current_setting('t.x')::uuid) $$,
  '42501', null, 'não concede a quem não está na unidade (fora do escopo → negado)');
select throws_ok($$ select public.grant_role('00000000-0000-0000-0000-0000000000a1', 'tech_admin', current_setting('t.x')::uuid) $$,
  '42501', null, 'papel técnico nunca pela tela');
select set_config('t.r', public.grant_role('00000000-0000-0000-0000-0000000000a1', 'spokesperson', current_setting('t.x')::uuid)::text, true);
select is((select role from public.roles_in_my_scope() where id = current_setting('t.r')::uuid), 'spokesperson',
  'a coordenação vê o papel concedido no seu escopo');

reset role;
select is((select count(*)::int from public.audit_log where event = 'role_granted' and target_id = '00000000-0000-0000-0000-0000000000a1'
  and actor_id = '00000000-0000-0000-0000-0000000000c1'), 1, 'a concessão foi para o audit_log');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.revoke_role(current_setting('t.r')::uuid) $$, '42501', null, 'quem recebeu não revoga o próprio papel');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.revoke_role(current_setting('t.r')::uuid);
select is((select count(*)::int from public.roles_in_my_scope() where id = current_setting('t.r')::uuid), 0, 'revogado sai da lista');

reset role;
select is((select count(*)::int from public.audit_log where event = 'role_revoked' and target_id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'a revogação foi para o audit_log');

select * from finish();
rollback;
