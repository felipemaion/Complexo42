-- Medalhas (ADR 0006 §8, ADR 0007 §3; #34, #35, #37): coordenador cria e concede no escopo,
-- ninguém concede a si mesmo, revogação com motivo e auditoria. Pessoas fictícias.
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

select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.badges'::regclass, 'public.profile_badges'::regclass)),
  'badges e profile_badges têm RLS ligada'
);

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
select pg_temp.add_unit('team', 'abc', 'team_y');

-- c1 monitor da região ABC | c2 monitor só da equipe Y | a1, a2 equipe X
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
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
select '00000000-0000-0000-0000-0000000000c2', 'monitor', id from public.units where slug = 'team_y';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('abc', '00000000-0000-0000-0000-0000000000c1'::uuid), ('team_x', '00000000-0000-0000-0000-0000000000a1'),
  ('team_x', '00000000-0000-0000-0000-0000000000a2'), ('team_y', '00000000-0000-0000-0000-0000000000c2')
) as v (slug, p) join public.units as u on u.slug = v.slug;
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.create_badge(current_setting('t.abc')::uuid, 'Melhor roteiro', '', 'trofeu') $$,
  '42501', null, 'membro sem papel não cria medalha');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select set_config('t.badge', public.create_badge(current_setting('t.abc')::uuid, 'Melhor roteiro do mês', 'Para o roteiro mais claro', 'trofeu')::text, true);
select is((select count(*)::int from public.badge_options() where id = current_setting('t.badge')::uuid), 1,
  'coordenador cria a medalha e ela aparece nas opções');
select throws_ok($$ select public.grant_badge(current_setting('t.badge')::uuid, '00000000-0000-0000-0000-0000000000c1', 'eu mereço') $$,
  '42501', null, 'ninguém concede medalha a si mesmo');
select throws_ok($$ select public.grant_badge(current_setting('t.badge')::uuid, '00000000-0000-0000-0000-0000000000a1', 'ok') $$,
  '22023', null, 'motivo curto demais é recusado');
select set_config('t.award', public.grant_badge(current_setting('t.badge')::uuid, '00000000-0000-0000-0000-0000000000a1', 'Roteiro do debate de novembro')::text, true);
select throws_ok($$ select public.grant_badge(current_setting('t.badge')::uuid, '00000000-0000-0000-0000-0000000000a1', 'De novo a mesma') $$,
  '23505', null, 'a mesma medalha ativa não é concedida duas vezes à mesma pessoa');

select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$ select public.grant_badge(current_setting('t.badge')::uuid, '00000000-0000-0000-0000-0000000000a2', 'Fora do meu escopo') $$,
  '42501', null, 'coordenador de outra equipe não concede esta medalha (fora do escopo → negado)');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select name from public.profile_badge_list('00000000-0000-0000-0000-0000000000a1')), 'Melhor roteiro do mês',
  'a pessoa vê a própria medalha com o motivo');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.revoke_badge(current_setting('t.award')::uuid, 'Concedida por engano');
select throws_ok($$ select public.revoke_badge(current_setting('t.award')::uuid, 'De novo') $$,
  'C7612', null, 'medalha já revogada não é revogada de novo');
select is_empty($$ select * from public.profile_badge_list('00000000-0000-0000-0000-0000000000a1') $$,
  'medalha revogada some do perfil');

reset role;
select results_eq(
  $$ select event from public.audit_log where target_id = current_setting('t.award')::uuid order by id $$,
  $$ values ('badge_granted'), ('badge_revoked') $$,
  'concessão e revogação ficam na auditoria'
);

select * from finish();
rollback;
