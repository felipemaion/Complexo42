-- Medalhas automáticas (#36, ADR 0006 §8): "missão concluída" e "limite de pontos". A coordenação
-- cria; o banco concede sozinho a quem cumpre a regra dentro do escopo, uma vez só, e não devolve
-- medalha revogada. Pessoas fictícias.
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
select pg_temp.add_unit('team', 'zl', 'team_z');

-- c1 monitor da região ABC | a1 equipe X (ABC) | z1 equipe Z (fora do escopo ABC)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'monitor', id from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('abc', '00000000-0000-0000-0000-0000000000c1'::uuid), ('team_x', '00000000-0000-0000-0000-0000000000a1'),
  ('team_z', '00000000-0000-0000-0000-0000000000f1')
) as v (slug, p) join public.units as u on u.slug = v.slug;
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);

set local role authenticated;

-- Quem pode criar
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.create_auto_badge(current_setting('t.abc')::uuid, 'Trinta pontos', '', 'fogo', 'points_threshold', null, 30) $$,
  '42501', null, 'membro sem papel não cria medalha automática');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.create_auto_badge(current_setting('t.abc')::uuid, 'Errada', '', 'fogo', 'manual', null, null) $$,
  '22023', null, 'regra que não é automática é recusada');
select throws_ok($$ select public.create_auto_badge(current_setting('t.abc')::uuid, 'Zero pontos', '', 'fogo', 'points_threshold', null, 0) $$,
  '22023', null, 'limite de pontos precisa ser positivo');
select throws_ok($$ select public.create_auto_badge(current_setting('t.abc')::uuid, 'Sem missão', '', 'trofeu', 'mission_completed', null, null) $$,
  '22023', null, 'medalha de missão concluída precisa da missão');

-- Uma missão individual de duas etapas (20 + 20 pontos) e as duas medalhas automáticas.
select set_config('t.mission', public.publish_mission('Missão de teste', '', 'escrita', current_setting('t.abc')::uuid, 'individual',
  '[{"title":"Primeira etapa","points":20,"evidence_type":"none"},{"title":"Segunda etapa","points":20,"evidence_type":"none"}]')::text, true);
select set_config('t.pts', public.create_auto_badge(current_setting('t.abc')::uuid, 'Trinta pontos', 'Juntou 30 pontos', 'fogo', 'points_threshold', null, 30)::text, true);
select set_config('t.done', public.create_auto_badge(current_setting('t.abc')::uuid, 'Missão cumprida', '', 'trofeu', 'mission_completed', current_setting('t.mission')::uuid, null)::text, true);
select is((select rule_type || ':' || (rule_params ->> 'points') from public.badges where id = current_setting('t.pts')::uuid),
  'points_threshold:30', 'a regra e o limite ficam guardados na medalha');

-- Etapa 1 aprovada: 20 pontos, ainda sem medalha.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_config('t.run', public.start_mission_run(current_setting('t.mission')::uuid)::text, true);
select set_config('t.s1', public.submit_step(current_setting('t.run')::uuid,
  (select id from public.mission_steps where mission_id = current_setting('t.mission')::uuid and position = 1), null, null)::text, true);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.review_submission(current_setting('t.s1')::uuid, true, null);
select is((select count(*)::int from public.profile_badges where profile_id = '00000000-0000-0000-0000-0000000000a1'), 0,
  'com 20 pontos e a missão pela metade, nenhuma medalha automática');

-- Etapa 2 aprovada: 40 pontos e missão concluída, as duas medalhas chegam sozinhas.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_config('t.s2', public.submit_step(current_setting('t.run')::uuid,
  (select id from public.mission_steps where mission_id = current_setting('t.mission')::uuid and position = 2), null, null)::text, true);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.review_submission(current_setting('t.s2')::uuid, true, null);
reset role;
select is((select count(*)::int from public.profile_badges where profile_id = '00000000-0000-0000-0000-0000000000a1' and badge_id = current_setting('t.pts')::uuid and revoked_at is null), 1,
  'ao passar de 30 pontos a medalha de pontos é concedida');
select is((select count(*)::int from public.profile_badges where profile_id = '00000000-0000-0000-0000-0000000000a1' and badge_id = current_setting('t.done')::uuid), 1,
  'ao concluir a missão a medalha da missão é concedida');
select ok((select bool_and(awarded_by is null) from public.profile_badges where profile_id = '00000000-0000-0000-0000-0000000000a1'),
  'concessão automática não tem pessoa concedente');

-- Chamar de novo não duplica.
select app.award_auto_badges('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.profile_badges where profile_id = '00000000-0000-0000-0000-0000000000a1'), 2,
  'rodar a regra de novo não duplica medalhas');

-- Medalha revogada não volta sozinha.
update public.profile_badges set revoked_at = now(), revoked_reason = 'teste de revogação'
where profile_id = '00000000-0000-0000-0000-0000000000a1' and badge_id = current_setting('t.pts')::uuid;
select app.award_auto_badges('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.profile_badges where profile_id = '00000000-0000-0000-0000-0000000000a1' and badge_id = current_setting('t.pts')::uuid and revoked_at is null), 0,
  'medalha automática revogada não é concedida de novo');

-- Fora do escopo da medalha: pontos não dão a medalha da região ABC.
insert into public.points_ledger (unit_id, profile_id, points, reason)
select id, '00000000-0000-0000-0000-0000000000f1', 50, 'ajuste de teste' from public.units where slug = 'team_z';
select is((select count(*)::int from public.profile_badges where profile_id = '00000000-0000-0000-0000-0000000000f1'), 0,
  'quem está fora do escopo da medalha não a recebe (fora do escopo → negado)');

select ok(not has_function_privilege('authenticated', 'app.award_auto_badges(uuid)', 'execute'),
  'a regra automática não pode ser chamada direto pelo app');

select * from finish();
rollback;
