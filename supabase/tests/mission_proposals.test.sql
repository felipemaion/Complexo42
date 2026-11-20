-- Propostas de missão pela equipe (#57, ADR 0006 §5): quem está numa equipe propõe; a coordenação
-- do escopo ajusta os pontos e publica, ou recusa com justificativa. A proposta só aparece para a
-- própria equipe e para a coordenação. Pessoas fictícias.
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
select pg_temp.add_unit('team', 'abc', 'team_y');
select pg_temp.add_unit('region', 'sp', 'zl');

-- a1 equipe X | b1 equipe Y | c1 monitor ABC | c9 monitor ZL | e1 sem equipe (só na região)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c9'),
  ('00000000-0000-0000-0000-0000000000e1');
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
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('team_x', '00000000-0000-0000-0000-0000000000a1'::uuid), ('team_y', '00000000-0000-0000-0000-0000000000b1'),
  ('abc', '00000000-0000-0000-0000-0000000000c1'), ('zl', '00000000-0000-0000-0000-0000000000c9'),
  ('abc', '00000000-0000-0000-0000-0000000000e1')
) as v (slug, p) join public.units as u on u.slug = v.slug;
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);

set local role authenticated;

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$ select public.propose_mission('Mutirão de limpeza', '', 'acao', '[{"title":"Marcar o dia","points":10,"evidence_type":"text"}]') $$,
  '42501', null, 'quem não está numa equipe não propõe');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.propose_mission('Mutirão de limpeza', '', 'acao', '[]') $$,
  '22023', null, 'proposta precisa de 1 a 3 etapas');
select set_config('t.p1', public.propose_mission('Mutirão de limpeza da praça', 'Limpar a praça com os moradores.', 'acao',
  '[{"title":"Marcar o dia","points":10,"evidence_type":"text"},{"title":"Fazer o mutirão","points":50,"evidence_type":"link"}]')::text, true);
select set_config('t.p2', public.propose_mission('Sarau na escola', '', 'evento', '[{"title":"Fazer o sarau","points":30,"evidence_type":"none"}]')::text, true);
select is((select status from public.my_team_proposals() where id = current_setting('t.p1')::uuid), 'proposed', 'a equipe vê a própria proposta');

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.my_team_proposals()), 0, 'outra equipe não vê a proposta');
select is((select count(*)::int from public.missions where id = current_setting('t.p1')::uuid), 0,
  'proposta não aparece na leitura direta de missões de outra equipe');

select pg_temp.login('00000000-0000-0000-0000-0000000000c9');
select is((select count(*)::int from public.pending_proposals()), 0, 'coordenação de outra região não vê (fora do escopo → negado)');
select throws_ok($$ select public.decide_proposal(current_setting('t.p1')::uuid, true, null, null, null) $$,
  '42501', null, 'coordenação de outra região não decide');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.pending_proposals()), 2, 'a coordenação da região vê as propostas abertas');
select throws_ok($$ select public.decide_proposal(current_setting('t.p2')::uuid, false, null, null, 'ok') $$,
  '22023', null, 'recusa precisa de justificativa (3 letras ou mais)');
select public.decide_proposal(current_setting('t.p2')::uuid, false, null, null, 'A escola está em reforma este mês.');
select public.decide_proposal(current_setting('t.p1')::uuid, true, current_setting('t.abc')::uuid, array[20, 60], null);
select is((select status || ':' || scope_unit_id::text from public.missions where id = current_setting('t.p1')::uuid),
  'published:' || current_setting('t.abc'), 'aprovada vira missão publicada no escopo escolhido');
select is((select string_agg(points::text, ',' order by position) from public.mission_steps where mission_id = current_setting('t.p1')::uuid),
  '20,60', 'a coordenação ajusta os pontos ao publicar');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select status || '|' || coalesce(decision_note, '') from public.my_team_proposals() where id = current_setting('t.p2')::uuid),
  'archived|A escola está em reforma este mês.', 'a equipe vê a recusa com a justificativa');
select throws_ok($$ select public.decide_proposal(current_setting('t.p1')::uuid, true, null, null, null) $$,
  '42501', null, 'membro não decide proposta');

select * from finish();
rollback;
