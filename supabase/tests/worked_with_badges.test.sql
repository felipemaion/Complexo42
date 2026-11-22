-- Medalha "trabalhou com" (#71, ADR 0007 §3): cada porta-voz tem a sua, criada sozinha; só ele
-- concede, a quem teve vínculo na equipe dele enquanto ele era porta-voz; ninguém a si mesmo; a
-- concessão manual da coordenação não dá essa medalha. Pessoas fictícias, só nesta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
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
select pg_temp.add_unit('team', 'abc', 'team_a');
select pg_temp.add_unit('team', 'abc', 'team_b');

-- a1 porta-voz da team_a há 30 dias | b1 na equipe desde antes | b2 saiu há 10 dias (depois de a1
-- assumir) | b3 saiu há 40 dias (antes) | d1 de outra equipe | e1 membro comum | c1 gestor do ABC
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000b4');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n' || right(id::text, 2)), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000__';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000__';
-- b4 está na equipe, mas com o acesso bloqueado.
update public.profiles set access_status = 'blocked' where id = '00000000-0000-0000-0000-0000000000b4';

insert into public.unit_members (unit_id, profile_id, joined_at, left_at)
select u.id, v.p, now() - v.joined, case when v.left_ago is null then null else now() - v.left_ago end
from (values
  ('team_a', '00000000-0000-0000-0000-0000000000a1'::uuid, interval '90 days', null::interval),
  ('team_a', '00000000-0000-0000-0000-0000000000b1', interval '60 days', null),
  ('team_a', '00000000-0000-0000-0000-0000000000b2', interval '60 days', interval '10 days'),
  ('team_a', '00000000-0000-0000-0000-0000000000b3', interval '100 days', interval '40 days'),
  ('team_b', '00000000-0000-0000-0000-0000000000d1', interval '60 days', null),
  ('team_a', '00000000-0000-0000-0000-0000000000e1', interval '60 days', null),
  ('team_a', '00000000-0000-0000-0000-0000000000b4', interval '60 days', null),
  ('abc', '00000000-0000-0000-0000-0000000000c1', interval '90 days', null)
) as v (slug, p, joined, left_ago) join public.units as u on u.slug = v.slug;

insert into public.role_assignments (profile_id, role, unit_id, granted_at)
select '00000000-0000-0000-0000-0000000000a1', 'spokesperson', id, now() - interval '30 days' from public.units where slug = 'team_a';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'manager', id from public.units where slug = 'abc';

-- a) Virar porta-voz cria a medalha dele, na equipe dele.
select is((select count(*)::int from public.badges as b join public.units as u on u.id = b.scope_unit_id
           where b.rule_type = 'worked_with' and b.created_by = '00000000-0000-0000-0000-0000000000a1' and u.slug = 'team_a'),
  1, 'virar porta-voz cria a medalha "trabalhou com" dele');
select set_config('test.badge', (select id::text from public.badges where rule_type = 'worked_with'
  and created_by = '00000000-0000-0000-0000-0000000000a1'), true);

-- h) Sem sessão (anon) não concede.
set local role anon;
select throws_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000b1') $$, '42501', null,
  'anon não concede');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

-- b) O porta-voz concede a quem está na equipe; a medalha aparece com o porta-voz como dono.
select lives_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000b1') $$,
  'o porta-voz concede a quem está na equipe');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.profile_badge_list('00000000-0000-0000-0000-0000000000b1')
           where owner_id = '00000000-0000-0000-0000-0000000000a1' and owner_name_enc is not null and name = 'Trabalhou com'),
  1, 'a medalha aparece na lista da pessoa com o porta-voz e o nome dele cifrado');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
-- c) De novo para a mesma pessoa: já tem.
select throws_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000b1') $$, '23505', null,
  'não concede duas vezes à mesma pessoa');
-- d) A si mesmo: nunca.
select throws_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000a1') $$, '42501',
  'ninguém concede medalha a si mesmo', 'ninguém concede a si mesmo');
-- e) Outra equipe: não.
select throws_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000d1') $$, '42501',
  'só a quem esteve na sua equipe', 'não concede a quem é de outra equipe');
-- g) Saiu antes de o porta-voz assumir: não; saiu depois: sim.
select throws_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000b3') $$, '42501',
  'só a quem esteve na sua equipe', 'não concede a quem saiu antes de ele ser porta-voz');
select throws_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000b4') $$, '42501',
  'só a quem está com o acesso liberado', 'não concede a quem está com o acesso bloqueado');
select lives_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000b2') $$,
  'concede a quem saiu depois (trabalharam juntos no período)');

-- f) Membro comum (não é porta-voz) não concede.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$ select public.grant_worked_with('00000000-0000-0000-0000-0000000000b1') $$, '42501',
  'só a quem esteve na sua equipe', 'quem não é porta-voz não concede');

-- i) A função que cria a medalha não é para o app.
select throws_ok($$ select app.ensure_worked_with_badge('00000000-0000-0000-0000-0000000000e1',
  (select id from public.units where slug = 'team_a')) $$, '42501', null, 'o app não cria medalha "trabalhou com" direto');

-- j) A coordenação não dá a medalha do porta-voz pela concessão manual.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.grant_badge(current_setting('test.badge')::uuid, '00000000-0000-0000-0000-0000000000e1', 'Motivo qualquer') $$,
  '42501', null, 'a concessão manual não dá a medalha "trabalhou com"');

-- Quem é de outra equipe não vê a lista de medalhas de b1 (nem o nome do porta-voz).
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.profile_badge_list('00000000-0000-0000-0000-0000000000b1')), 0,
  'quem não pode ver a pessoa não vê as medalhas dela');

-- Cada concessão vai para o registro (badge_granted), como a concessão manual.
reset role;
select is((select count(*)::int from public.audit_log
           where event = 'badge_granted' and actor_id = '00000000-0000-0000-0000-0000000000a1'), 2,
  'as duas concessões do porta-voz ficaram no registro');

select * from finish();
rollback;
