-- Missões, entregas e livro-razão (ADR 0006 §3–§5, issues #30–#33). Pessoas fictícias, só
-- dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.missions'::regclass, 'public.mission_steps'::regclass, 'public.mission_runs'::regclass,
    'public.mission_run_members'::regclass, 'public.step_submissions'::regclass,
    'public.points_ledger'::regclass)),
  'as 6 tabelas de missões têm RLS ligada'
);

-- Árvore: br ─ sp (SP) ─ abc ─┬─ team_x
--                             └─ team_y
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

-- Pessoas:
--   e1 manager da raiz (nacional)    c1 monitor da região ABC (valida)
--   a1, a2 equipe X                  b1 equipe Y
--   e2 monitor só da equipe Y (fora do escopo da equipe X)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active';

insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000e1', 'manager', id from public.units where slug = 'br';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'monitor', id from public.units where slug = 'abc';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000e2', 'monitor', id from public.units where slug = 'team_y';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.profile_id
from (values
  ('team_x', '00000000-0000-0000-0000-0000000000a1'::uuid),
  ('team_x', '00000000-0000-0000-0000-0000000000a2'),
  ('team_y', '00000000-0000-0000-0000-0000000000b1')
) as v (slug, profile_id) join public.units as u on u.slug = v.slug;

select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);
select set_config('t.br', (select id::text from public.units where slug = 'br'), true);
select set_config('t.team_x', (select id::text from public.units where slug = 'team_x'), true);

set local role authenticated;

-- ---------------------------------------------------------------------------------------
-- Publicar e propor (ADR 0006 §3 e §5)
-- ---------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ insert into public.missions (title, category, scope_unit_id, status, mode, created_by)
     values ('Texto sobre o orçamento', 'escrita', current_setting('t.abc')::uuid, 'published', 'team',
             '00000000-0000-0000-0000-0000000000c1') $$,
  'monitor publica missão no próprio escopo'
);
select lives_ok(
  $$ insert into public.mission_steps (mission_id, position, title, points, evidence_type)
     select id, 1, 'Escrever o texto', 10, 'link' from public.missions where title = 'Texto sobre o orçamento' $$,
  'monitor cria a etapa 1 (pede link)'
);
select lives_ok(
  $$ insert into public.mission_steps (mission_id, position, title, points, evidence_type, requires_previous)
     select id, 2, 'Protocolar na câmara', 30, 'protocol_number', true
     from public.missions where title = 'Texto sobre o orçamento' $$,
  'monitor cria a etapa 2 (pede protocolo, depois da 1)'
);
select is(
  (select origin from public.missions where title = 'Texto sobre o orçamento'), 'regional',
  'missão do monitor fica marcada como regional (trigger, não o formulário)'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select lives_ok(
  $$ insert into public.missions (title, category, scope_unit_id, status, mode, created_by)
     values ('Campanha nacional', 'campanha', current_setting('t.br')::uuid, 'published', 'individual',
             '00000000-0000-0000-0000-0000000000e1') $$,
  'nacional publica missão para todos'
);
select is(
  (select origin from public.missions where title = 'Campanha nacional'), 'national',
  'a origem vem do papel: manager da raiz = nacional'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok(
  $$ insert into public.missions (title, category, scope_unit_id, status, mode, created_by)
     values ('Fora do escopo', 'escrita', current_setting('t.abc')::uuid, 'published', 'team',
             '00000000-0000-0000-0000-0000000000e2') $$,
  '42501', null,
  'monitor da equipe Y não publica para a região inteira (fora do escopo → negado)'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ insert into public.missions (title, category, scope_unit_id, status, mode, created_by)
     values ('Publicação indevida', 'escrita', current_setting('t.team_x')::uuid, 'published', 'team',
             '00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'membro não publica missão'
);
select lives_ok(
  $$ insert into public.missions (title, category, scope_unit_id, status, mode, created_by, proposed_by_unit_id)
     values ('Limpar a praça', 'acao', current_setting('t.team_x')::uuid, 'proposed', 'team',
             '00000000-0000-0000-0000-0000000000a1', current_setting('t.team_x')::uuid) $$,
  'membro propõe missão para a própria equipe'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from public.missions where title = 'Limpar a praça'), 0,
  'a outra equipe não vê a proposta'
);
select is(
  (select count(*)::int from public.missions where title in ('Texto sobre o orçamento', 'Campanha nacional')), 2,
  'a equipe Y vê as missões publicadas para a região e para todos'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  (select count(*)::int from public.missions where title = 'Limpar a praça'), 1,
  'o monitor da região vê a proposta para revisar'
);

-- ---------------------------------------------------------------------------------------
-- Execução e entrega
-- ---------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_config('t.run',
  app.start_mission_run((select id from public.missions where title = 'Texto sobre o orçamento'))::text, true);
select is(
  app.start_mission_run((select id from public.missions where title = 'Texto sobre o orçamento'))::text,
  current_setting('t.run'),
  'assumir de novo devolve a mesma execução (idempotente)'
);
select is(
  (select count(*)::int from public.mission_run_members where run_id = current_setting('t.run')::uuid), 2,
  'na missão de equipe, os dois membros da equipe X participam'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from public.mission_runs where id = current_setting('t.run')::uuid), 0,
  'membro de outra equipe não vê a execução'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select app.submit_step(current_setting('t.run')::uuid,
       (select id from public.mission_steps where title = 'Escrever o texto'), 'http://inseguro.exemplo') $$,
  '22023', null,
  'etapa que pede link recusa link sem https'
);
select throws_ok(
  $$ select app.submit_step(current_setting('t.run')::uuid,
       (select id from public.mission_steps where title = 'Protocolar na câmara'), null, 'PL 123/2026') $$,
  'P0001', null,
  'etapa 2 só abre depois da 1 aprovada'
);
select set_config('t.sub1', app.submit_step(current_setting('t.run')::uuid,
  (select id from public.mission_steps where title = 'Escrever o texto'), 'https://exemplo.org/texto')::text, true);
select throws_ok(
  $$ insert into public.step_submissions (run_id, step_id, submitted_by)
     values (current_setting('t.run')::uuid, (select id from public.mission_steps where title = 'Escrever o texto'),
             '00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'o cliente não grava entrega direto na tabela (só pela função)'
);

-- ---------------------------------------------------------------------------------------
-- Validação e pontos (ADR 0006 §4)
-- ---------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$ select app.approve_submission(current_setting('t.sub1')::uuid, true) $$,
  '42501', null,
  'quem participou não valida a própria entrega (antifraude)'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok(
  $$ select app.approve_submission(current_setting('t.sub1')::uuid, true) $$,
  '42501', null,
  'monitor de outra equipe não valida (fora do escopo → negado)'
);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ select app.approve_submission(current_setting('t.sub1')::uuid, true, 'Bom texto') $$,
  'monitor da região valida a entrega'
);
select results_eq(
  $$ select count(*)::int, sum(points)::int from public.points_ledger
     where submission_id = current_setting('t.sub1')::uuid $$,
  $$ values (3, 30) $$,
  'pontos lançados: 10 para a equipe e 10 para cada um dos 2 participantes'
);
select throws_ok(
  $$ select app.approve_submission(current_setting('t.sub1')::uuid, true) $$,
  'P0001', null,
  'a mesma entrega não é validada duas vezes'
);
select throws_ok(
  $$ insert into public.points_ledger (unit_id, points, reason)
     values (current_setting('t.team_x')::uuid, 100, 'pontos na mão') $$,
  '42501', null,
  'ninguém lança pontos direto na tabela'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_config('t.sub2', app.submit_step(current_setting('t.run')::uuid,
  (select id from public.mission_steps where title = 'Protocolar na câmara'), null, 'PL 123/2026')::text, true);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select app.approve_submission(current_setting('t.sub2')::uuid, true);
select is(
  (select status from public.mission_runs where id = current_setting('t.run')::uuid), 'completed',
  'com todas as etapas aprovadas, a execução termina'
);

reset role;
select is(
  (select count(*)::int from public.audit_log
   where event = 'submission_approved' and target_id = current_setting('t.sub1')::uuid
     and actor_id = '00000000-0000-0000-0000-0000000000c1'),
  1,
  'a auditoria registra quem validou'
);
select throws_ok(
  $$ update public.points_ledger set points = 999 where submission_id = current_setting('t.sub1')::uuid $$,
  '42501', null,
  'o livro-razão não aceita edição (nem pelo dono do banco)'
);
select throws_ok(
  $$ delete from public.points_ledger where submission_id = current_setting('t.sub1')::uuid $$,
  '42501', null,
  'o livro-razão não aceita exclusão'
);
select lives_ok(
  $$ delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'excluir a conta de quem participou funciona: os pontos da equipe ficam, sem dono'
);
select is(
  (select count(*)::int from public.points_ledger
   where submission_id = current_setting('t.sub1')::uuid and profile_id is null),
  2,
  'depois da exclusão, o lançamento individual fica anônimo ao lado do da equipe'
);

select * from finish();
rollback;
