-- Draft do 2º ciclo (ata de 17/11 §6) e pedido auditado de leitura de avaliação (ADR 0007 §4).
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

-- c1 manager da região | e1 líder da X | e2 líder da Y | d1..d4 sem equipe (entram em ordem)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000e2'), ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d2'), ('00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-0000000000d4');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'manager', id from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id, member_role, joined_at)
select u.id, v.p, v.r, now() - (v.ord || ' minutes')::interval from (values
  ('team_x', '00000000-0000-0000-0000-0000000000e1'::uuid, 'lead', 10),
  ('team_y', '00000000-0000-0000-0000-0000000000e2', 'lead', 10),
  ('abc', '00000000-0000-0000-0000-0000000000d1', 'member', 9),
  ('abc', '00000000-0000-0000-0000-0000000000d2', 'member', 8),
  ('abc', '00000000-0000-0000-0000-0000000000d3', 'member', 7),
  ('abc', '00000000-0000-0000-0000-0000000000d4', 'member', 6)
) as v (slug, p, r, ord) join public.units as u on u.slug = v.slug;
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);
select set_config('t.x', (select id::text from public.units where slug = 'team_x'), true);
select set_config('t.y', (select id::text from public.units where slug = 'team_y'), true);

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$ select public.open_draft(current_setting('t.abc')::uuid, array[current_setting('t.x')::uuid, current_setting('t.y')::uuid]) $$,
  '42501', null, 'líder de equipe não abre o draft (só a coordenação da região)');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select set_config('t.s', public.open_draft(current_setting('t.abc')::uuid,
  array[current_setting('t.x')::uuid, current_setting('t.y')::uuid], 2)::text, true);
select is((select team_on_turn::text from public.draft_state()), current_setting('t.x'), 'a 1ª equipe da ordem escolhe primeiro');
select set_eq($$ select profile_id from public.draft_options(current_setting('t.s')::uuid) $$,
  $$ values ('00000000-0000-0000-0000-0000000000d1'::uuid), ('00000000-0000-0000-0000-0000000000d2') $$,
  'só um trecho da lista (2 primeiras pessoas), nunca a lista inteira');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select public.draft_pick(current_setting('t.s')::uuid, '00000000-0000-0000-0000-0000000000d1') $$,
  '42501', null, 'fora da vez → negado');

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$ select public.draft_pick(current_setting('t.s')::uuid, '00000000-0000-0000-0000-0000000000d4') $$,
  '22023', null, 'pessoa fora do trecho → recusada');
select public.draft_pick(current_setting('t.s')::uuid, '00000000-0000-0000-0000-0000000000d2');
select is((select team_on_turn::text from public.draft_state()), current_setting('t.y'), 'depois da escolha, a vez passa');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select public.draft_pick(current_setting('t.s')::uuid, '00000000-0000-0000-0000-0000000000d1');
select is((select team_on_turn::text from public.draft_state()), current_setting('t.y'), 'serpentina: a última equipe escolhe de novo');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.close_draft(current_setting('t.s')::uuid);
select is_empty($$ select * from public.draft_state() $$, 'draft encerrado; quem sobrou fica para a coordenação');
reset role;
select is((select u.slug from public.unit_members m join public.units u on u.id = m.unit_id
           where m.profile_id = '00000000-0000-0000-0000-0000000000d2' and m.left_at is null), 'team_x',
  'a pessoa escolhida entrou na equipe');

-- Pedido auditado de leitura de avaliação
insert into public.member_evaluations (profile_id, evaluator_id, unit_id, axis, cycle_ends_on, grade_enc)
select '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', id, 'team', current_date, pg_temp.enc('ouro')
from public.units where slug = 'team_x';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select * from public.request_evaluation_access('00000000-0000-0000-0000-0000000000d2', 'Preciso indicar para uma missão') $$,
  '42501', null, 'quem não é gestor do escopo não pede acesso');
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select * from public.request_evaluation_access('00000000-0000-0000-0000-0000000000d2', 'curto') $$,
  '22023', null, 'sem motivo de verdade → recusado');
select is((select count(*)::int from public.request_evaluation_access('00000000-0000-0000-0000-0000000000d2', 'Indicação para o campeonato de debates')), 1,
  'gestor com motivo lê a avaliação');
reset role;
select is((select count(*)::int from public.audit_log where event = 'evaluation_viewed'
           and target_id = '00000000-0000-0000-0000-0000000000d2'), 1, 'o pedido fica na auditoria');

select * from finish();
rollback;
