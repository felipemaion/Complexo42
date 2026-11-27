-- Telas da coordenação do questionário (issue #174, ADR 0014): quem pode ver e resolver
-- (`questionnaire_coordination_access`) e o evento de auditoria de quem abre o resultado de
-- alguém (`log_questionnaire_view`, evento `questionnaire_result_viewed`: ator e alvo, sem
-- conteúdo, visível só à coordenação nacional). Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select path::text, id from public.units where path::text in ('br', 'br.sp', 'br.mg');
create function pg_temp.unit(p_path text) returns uuid language sql stable as $$ select id from unit_ids where slug = p_path $$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000a1', 'root.mgr@exemplo.org'), -- coordenação nacional
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000a2', 'sp.mgr@exemplo.org'),   -- gestor de SP, com delegação
  ('mg_mgr',   '00000000-0000-0000-0000-0000000000a3', 'mg.mgr@exemplo.org'),   -- gestor de MG, sem delegação
  ('p_sp',     '00000000-0000-0000-0000-0000000000a4', 'p.sp@exemplo.org'),     -- pessoa ativa em SP
  ('p_mg',     '00000000-0000-0000-0000-0000000000a5', 'p.mg@exemplo.org'),     -- pessoa ativa em MG
  ('plain',    '00000000-0000-0000-0000-0000000000a6', 'plain@exemplo.org');    -- pessoa comum
insert into auth.users (id, email) select id, email from people;

create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people, unit_ids to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people);

-- p_mg fica em Minas Gerais (fora do escopo do gestor de SP).
update public.unit_members set left_at = now() where profile_id = pg_temp.person('p_mg') and left_at is null;
insert into public.unit_members (unit_id, profile_id) values (pg_temp.unit('br.mg'), pg_temp.person('p_mg'));

insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('br.sp')),
  (pg_temp.person('mg_mgr'), 'manager', pg_temp.unit('br.mg'));

create function pg_temp.access_of(p_name text) returns jsonb language plpgsql as $$
begin
  perform pg_temp.login(p_name);
  return public.questionnaire_coordination_access();
end;
$$;
grant execute on function pg_temp.access_of(text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Quem vê e resolve: a nacional, o delegado com concessão válida; ninguém mais
-- ---------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.questionnaire_coordination_access() $$, '42501', null, 'anônimo NÃO consulta a permissão');

set local role authenticated;
select is(pg_temp.access_of('root_mgr'), '{"national": true, "delegate": false}'::jsonb, 'a coordenação nacional: tudo');
select is(pg_temp.access_of('sp_mgr'), '{"national": false, "delegate": false}'::jsonb, 'gestor de SP sem concessão: nada');
select is(pg_temp.access_of('plain'), '{"national": false, "delegate": false}'::jsonb, 'pessoa comum: nada');

select pg_temp.login('root_mgr');
create temp table grants (id uuid);
grant select, insert on grants to authenticated;
insert into grants select public.grant_questionnaire_access(pg_temp.person('sp_mgr'), pg_temp.unit('br.sp'));
select is(pg_temp.access_of('sp_mgr'), '{"national": false, "delegate": true}'::jsonb, 'com concessão: delegado (não nacional)');
select is(pg_temp.access_of('mg_mgr'), '{"national": false, "delegate": false}'::jsonb, 'a concessão de SP não vale para o gestor de MG');

-- Só o papel de gestor revogado, com a concessão viva: perde.
reset role;
create temp table sp_role (id uuid);
insert into sp_role select id from public.role_assignments where profile_id = pg_temp.person('sp_mgr') and role = 'manager' and revoked_at is null;
update public.role_assignments set revoked_at = now() where id = (select id from sp_role);
set local role authenticated;
select is(pg_temp.access_of('sp_mgr'), '{"national": false, "delegate": false}'::jsonb, 'papel de gestor revogado, concessão viva: nada');
reset role;
update public.role_assignments set revoked_at = null where id = (select id from sp_role);
set local role authenticated;
select is(pg_temp.access_of('sp_mgr'), '{"national": false, "delegate": true}'::jsonb, 'papel de volta: delegado de novo');

-- ---------------------------------------------------------------------------------------
-- Evento de auditoria ao abrir o resultado de alguém
-- ---------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, '42501', null, 'anônimo NÃO registra visualização');

set local role authenticated;
select pg_temp.login('plain');
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, '42501', null, 'pessoa comum NÃO abre o resultado de ninguém');
select pg_temp.login('mg_mgr');
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, '42501', null, 'gestor sem concessão NÃO abre');
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('p_mg')) $$, '42501', null, 'delegado NÃO abre o resultado de quem é de fora do escopo');
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('sp_mgr')) $$, '42501', null, 'ninguém registra a visualização do próprio resultado');
select throws_ok($$ select public.log_questionnaire_view(null) $$, '42501', null, 'alvo nulo é recusado');
select throws_ok($$ select public.log_questionnaire_view(gen_random_uuid()) $$, '42501', null, 'alvo inexistente é recusado (sem dizer se existe)');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 0, 'as recusas não geraram evento');

select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, 'o delegado abre o resultado de quem é do escopo dele');
select pg_temp.login('root_mgr');
select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('p_mg')) $$, 'a coordenação nacional abre o de qualquer pessoa ativa');
select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, '... inclusive de quem o delegado já abriu');
-- Abrir de novo logo em seguida (recarregar a página) não repete o evento: o mesmo ator e alvo,
-- dentro de 10 minutos, valem um só. Outro ator ou outro alvo registra à parte (acima).
select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, 'abrir de novo, logo em seguida, não dá erro');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed' and actor_id = pg_temp.person('root_mgr') and target_id = pg_temp.person('p_sp')), 1,
  '... e não repete o evento (mesmo ator e alvo em 10 minutos)');
-- Abrir de novo logo em seguida (recarregar a página) não repete o evento: o mesmo ator e alvo, em 10 minutos, valem um.
select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, 'abrir de novo, logo em seguida, não dá erro');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed' and actor_id = pg_temp.person('root_mgr') and target_id = pg_temp.person('p_sp')), 1,
  '... e não repete o evento (mesmo ator e alvo em 10 minutos)');
reset role;
update public.audit_log set created_at = created_at where false;
set local role authenticated;
select pg_temp.login('root_mgr');

reset role;
select results_eq(
  $$ select actor_id, target_id, reason, house_key, term_version, item_count, unit_id, grant_id from public.audit_log
     where event = 'questionnaire_result_viewed' order by created_at, id $$,
  $$ values (pg_temp.person('sp_mgr'), pg_temp.person('p_sp'), null::text, null::text, null::text, null::int, null::uuid, null::uuid),
            (pg_temp.person('root_mgr'), pg_temp.person('p_mg'), null, null, null, null, null, null),
            (pg_temp.person('root_mgr'), pg_temp.person('p_sp'), null, null, null, null, null, null) $$,
  'o evento guarda só quem viu e de quem (nada de conteúdo, casa, totem, notas nem termo)');

-- Quem lê o evento: só a coordenação nacional.
set local role authenticated;
select pg_temp.login('root_mgr');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 3, 'a coordenação nacional lê os eventos');
select pg_temp.login('sp_mgr');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 0,
  'o delegado NÃO lê os eventos (nem os que ele mesmo gerou), embora gerencie a pessoa vista');
select pg_temp.login('mg_mgr');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 0, 'gestor de MG, que gerencia p_mg, NÃO lê o evento sobre ela');
select pg_temp.login('p_sp');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 0, 'a pessoa vista NÃO lê quem abriu o resultado dela por aqui');
select pg_temp.login('plain');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 0, 'pessoa comum NÃO lê');

-- A própria pessoa vê, no "Baixar meus dados", que alguém abriu o resultado dela (LGPD art. 18).
select pg_temp.login('p_sp');
select is((select count(*)::int from jsonb_array_elements(public.export_own_data() -> 'audit_events') as e where e ->> 'event' = 'questionnaire_result_viewed'), 2,
  'a pessoa vista encontra os acessos ao resultado dela no próprio arquivo');

-- Revogada a concessão: o delegado deixa de abrir.
select pg_temp.login('root_mgr');
select lives_ok($$ select public.revoke_questionnaire_access((select id from grants)) $$, 'a nacional revoga a concessão de SP');
select pg_temp.login('sp_mgr');
select is(pg_temp.access_of('sp_mgr'), '{"national": false, "delegate": false}'::jsonb, 'revogada: sem permissão');
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, '42501', null, 'revogada: NÃO abre mais o resultado de ninguém');

-- Pessoa que não está ativa: nem a nacional abre.
reset role;
update public.profiles set status = 'suspended' where id = pg_temp.person('p_mg');
set local role authenticated;
select pg_temp.login('root_mgr');
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('p_mg')) $$, '42501', null, 'pessoa suspensa: nem a nacional registra (nem lê) o resultado');

select * from finish();
rollback;
