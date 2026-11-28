-- Telas da coordenação do questionário (issue #174, ADR 0014): quem pode ver e resolver
-- (`questionnaire_coordination_access`) e o evento de auditoria de quem abre o resultado de
-- alguém (`log_questionnaire_view`, evento `questionnaire_result_viewed`: ator e alvo, sem
-- conteúdo, visível só à coordenação nacional). Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(74);

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
  ('plain',    '00000000-0000-0000-0000-0000000000a6', 'plain@exemplo.org'),    -- pessoa comum
  ('p_sp2',    '00000000-0000-0000-0000-0000000000a7', 'p.sp2@exemplo.org'),    -- SP, casa trocada pela coordenação
  ('p_none',   '00000000-0000-0000-0000-0000000000a8', 'p.none@exemplo.org');   -- SP, sem casa aceita
insert into auth.users (id, email) select id, email from people;

create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people, unit_ids to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
-- Membro de verdade exige o termo vigente aceito (is_active_member, revisão do #227): quem tem perfil aceitou o termo.
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
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
-- Membro de verdade exige a casa aceita (ADR 0017): quem tem papel (coordenação) ganha uma casa só dele. Quem aceita casa no teste fica sem.
insert into public.houses (key, active) select 'g-' || profile_id::text, true from (select distinct profile_id from public.role_assignments) as r on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select r.profile_id, 'g-' || r.profile_id::text, 'self', now() from (select distinct profile_id from public.role_assignments) as r
where not exists (select 1 from public.house_members as h where h.profile_id = r.profile_id and h.left_at is null) on conflict do nothing;
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

-- ---------------------------------------------------------------------------------------
-- Casa sugerida × casa escolhida: `coordination_chosen_houses` (mesmo alcance das telas de resultado)
-- ---------------------------------------------------------------------------------------
reset role;
insert into public.houses (key, active) values ('casa-x', true), ('casa-y', true) on conflict (key) do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values
  (pg_temp.person('p_sp'), 'casa-x', 'self', now()),
  (pg_temp.person('p_sp2'), 'casa-x', 'self', now());
set local role anon;
select throws_ok($$ select * from public.coordination_chosen_houses(array[pg_temp.person('p_sp')]) $$, '42501', null, 'anônimo NÃO lê a casa escolhida');
set local role authenticated;
select pg_temp.login('root_mgr');
select lives_ok($$ select public.coordination_set_house(pg_temp.person('p_sp2'), 'casa-y') $$, 'a nacional troca a casa de p_sp2');
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('p_sp'), pg_temp.person('p_sp2'), pg_temp.person('p_none')])),
  3, 'a nacional lê as três pessoas (também a sem casa)'
);
select is(
  (select house_key from public.coordination_chosen_houses(array[pg_temp.person('p_sp')])), 'casa-x',
  'a casa escolhida é a do vínculo aberto'
);
select is(
  (select house_key from public.coordination_chosen_houses(array[pg_temp.person('p_none')])), null,
  'sem casa aceita, a casa escolhida é vazia'
);
select ok(
  (select chosen_at is not null and changed_by_coordination_at is not null and house_key = 'casa-y'
   from public.coordination_chosen_houses(array[pg_temp.person('p_sp2')])),
  'a troca feita pela coordenação aparece, com a casa nova e a data'
);
select is(
  (select changed_by_coordination_at from public.coordination_chosen_houses(array[pg_temp.person('p_sp')])), null,
  'sem troca pela coordenação, o campo é vazio'
);
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('root_mgr')])), 1,
  'a coordenação nacional lê a própria linha (#318)'
);
select pg_temp.login('mg_mgr');
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('mg_mgr'), pg_temp.person('p_sp'), pg_temp.person('p_mg')])), 0,
  'gestor sem concessão: o gate nega tudo, a própria linha também (#318)'
);
select pg_temp.login('plain');
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('plain')])), 0,
  'pessoa comum não lê nem a própria linha por esta função (a tela é da coordenação)'
);
select pg_temp.login('sp_mgr');
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('sp_mgr')])), 1,
  'o delegado lê a própria linha (#318)'
);
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('p_sp'), pg_temp.person('p_mg')])), 1,
  'o delegado lê só quem está no escopo da concessão'
);
select pg_temp.login('mg_mgr');
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('p_sp')])), 0,
  'gestor sem delegação não lê a casa escolhida'
);
select pg_temp.login('plain');
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('p_sp')])), 0,
  'pessoa comum não lê a casa escolhida de ninguém'
);

-- ---------------------------------------------------------------------------------------
-- Filtro "escolheu outra casa" no banco (todas as pessoas do alcance, não só a página) e limites
-- ---------------------------------------------------------------------------------------
reset role;
insert into app.questionnaire_term_versions (version) values ('termo-1') on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
values (pg_temp.person('p_mg'), 'casa-x', 'self', now());
-- p_sp: sugerida casa-x e escolheu casa-x; p_sp2: sugerida casa-x, escolheu casa-y; p_mg: sugerida casa-y, escolheu casa-x.
insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source) values
  (pg_temp.person('p_sp'), 'termo-1', 'casa-x', 'v1.AAAAAAAAAAAAAAAA.' || rpad('T1', 22, 'Z'), 'questionnaire'),
  (pg_temp.person('p_sp2'), 'termo-1', 'casa-x', 'v1.AAAAAAAAAAAAAAAA.' || rpad('T2', 22, 'Z'), 'questionnaire'),
  (pg_temp.person('p_mg'), 'termo-1', 'casa-y', 'v1.AAAAAAAAAAAAAAAA.' || rpad('T3', 22, 'Z'), 'questionnaire');
set local role anon;
select throws_ok($$ select * from public.coordination_other_house_results(null, 10) $$, '42501', null, 'anônimo NÃO lê quem escolheu outra casa');
set local role authenticated;
select pg_temp.login('root_mgr');
select set_eq(
  $$ select profile_id from public.coordination_other_house_results(null, 10) $$,
  $$ select pg_temp.person('p_sp2') union select pg_temp.person('p_mg') $$,
  'a nacional lê, no banco, todos os que escolheram outra casa'
);
select set_eq(
  $$ select profile_id from public.coordination_other_house_results('casa-y', 10) $$,
  $$ select pg_temp.person('p_mg') $$,
  'filtra também pela casa sugerida'
);
select is((select count(*)::int from public.coordination_other_house_results(null, 1)), 1, 'respeita o limite pedido');
select pg_temp.login('sp_mgr');
select set_eq(
  $$ select profile_id from public.coordination_other_house_results(null, 10) $$,
  $$ select pg_temp.person('p_sp2') $$,
  'o delegado lê só quem está no escopo da concessão'
);
select pg_temp.login('plain');
select is((select count(*)::int from public.coordination_other_house_results(null, 10)), 0, 'pessoa comum não lê nada');
select pg_temp.login('root_mgr');
select throws_ok($$ select * from public.coordination_chosen_houses(null) $$, '22023', null, 'lista nula de pessoas: erro claro');
select throws_ok(
  $$ select * from public.coordination_chosen_houses(array(select gen_random_uuid() from generate_series(1, 201))) $$,
  '22023', null, 'mais de 200 pessoas de uma vez: erro claro'
);
reset role;
update public.profiles set status = 'suspended' where id = pg_temp.person('p_sp2');
set local role authenticated;
select pg_temp.login('root_mgr');
select is(
  (select count(*)::int from public.coordination_chosen_houses(array[pg_temp.person('p_sp2')])), 0,
  'pessoa inativa: nem a nacional lê a casa escolhida'
);
select set_eq(
  $$ select profile_id from public.coordination_other_house_results(null, 10) $$,
  $$ select pg_temp.person('p_mg') $$,
  'pessoa inativa não entra no filtro "escolheu outra casa"'
);
reset role;
update public.profiles set status = 'active' where id = pg_temp.person('p_sp2');
set local role authenticated;

-- Bordas do filtro "escolheu outra casa": limite, vínculo não aceito ou encerrado, a própria pessoa.
reset role;
insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source) values
  (pg_temp.person('p_none'), 'termo-1', 'casa-x', 'v1.AAAAAAAAAAAAAAAA.' || rpad('T4', 22, 'Z'), 'questionnaire'),
  (pg_temp.person('plain'), 'termo-1', 'casa-x', 'v1.AAAAAAAAAAAAAAAA.' || rpad('T5', 22, 'Z'), 'questionnaire'),
  (pg_temp.person('root_mgr'), 'termo-1', 'casa-x', 'v1.AAAAAAAAAAAAAAAA.' || rpad('T6', 22, 'Z'), 'questionnaire');
-- p_none: vínculo aberto, mas NÃO aceito. plain: vínculo aceito e depois encerrado. root_mgr: aceito, outra casa.
insert into public.house_members (profile_id, house_key, join_method) values (pg_temp.person('p_none'), 'casa-y', 'self');
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at, left_at)
values (pg_temp.person('plain'), 'casa-y', 'self', now(), now(), now());
delete from public.house_members where profile_id = pg_temp.person('root_mgr') and house_key like 'g-%'; -- a casa de fixture dá lugar à casa deste teste
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values (pg_temp.person('root_mgr'), 'casa-y', 'self', now());
set local role authenticated;
select pg_temp.login('root_mgr');
select is((select count(*)::int from public.coordination_other_house_results(null, null)), 3, 'limite nulo: vale o máximo (todas as pessoas do alcance, a própria coordenação inclusive)');
select is((select count(*)::int from public.coordination_other_house_results(null, -5)), 1, 'limite negativo: vira 1');
select is((select count(*)::int from public.coordination_other_house_results(null, 1000)), 3, 'limite acima de 201: limitado ao máximo, sem erro');
select is((select count(*)::int from public.coordination_other_house_results(null, 10) where profile_id = pg_temp.person('p_none')), 0, 'vínculo aberto mas não aceito fica fora do filtro');
select is((select count(*)::int from public.coordination_other_house_results(null, 10) where profile_id = pg_temp.person('plain')), 0, 'vínculo encerrado fica fora do filtro');
select is((select count(*)::int from public.coordination_other_house_results(null, 10) where profile_id = pg_temp.person('root_mgr')), 1, 'a coordenação aparece para si mesma, como qualquer pessoa do alcance (#318)');
select is((select count(*)::int from public.coordination_other_house_results(null, 10) where profile_id = pg_temp.person('p_sp2')), 1, 'e quem escolheu outra casa continua aparecendo');
-- Negativos (#318): quem não é da coordenação não recebe nada, nem a própria linha; o delegado só o escopo dele.
select pg_temp.login('p_sp2');
select is((select count(*)::int from public.coordination_other_house_results(null, 10)), 0,
  'pessoa comum que escolheu outra casa não recebe nem a própria linha (o gate da própria pessoa é da coordenação)');
select pg_temp.login('mg_mgr');
select is((select count(*)::int from public.coordination_other_house_results(null, 10)), 0, 'gestor sem concessão não recebe ninguém');
select pg_temp.login('sp_mgr');
select ok((select count(*)::int from public.coordination_other_house_results(null, 10) where profile_id = pg_temp.person('p_sp2')) = 1,
  'o delegado de SP recebe quem é do escopo dele (controle)');
select is((select count(*)::int from public.coordination_other_house_results(null, 10) where profile_id = pg_temp.person('p_mg')), 0,
  'o delegado NÃO recebe quem é de fora do escopo (p_mg, de MG)');
select pg_temp.login('root_mgr');

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
select pg_temp.login('plain');
select throws_ok($$ select public.log_questionnaire_view(pg_temp.person('plain')) $$, '42501', null, 'pessoa comum NÃO registra nem o próprio resultado (não é da coordenação)');
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.log_questionnaire_view(null) $$, '42501', null, 'alvo nulo é recusado');
select throws_ok($$ select public.log_questionnaire_view(gen_random_uuid()) $$, '42501', null, 'alvo inexistente é recusado (sem dizer se existe)');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 0, 'as recusas não geraram evento');

select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('p_sp')) $$, 'o delegado abre o resultado de quem é do escopo dele');
select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('sp_mgr')) $$, 'o delegado abre o próprio resultado (#318)');
-- (O registro do acesso do delegado sobre si aparece na lista de eventos conferida como dono, mais abaixo; o delegado não lê a auditoria.)
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
-- A própria coordenação abre o próprio resultado como qualquer outro (#318): registra o acesso, uma vez em 10 minutos.
select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('root_mgr')) $$, 'a coordenação nacional abre o próprio resultado');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed' and actor_id = pg_temp.person('root_mgr') and target_id = pg_temp.person('root_mgr')), 1,
  '... e o acesso fica registrado, como o de qualquer outro');
select lives_ok($$ select public.log_questionnaire_view(pg_temp.person('root_mgr')) $$, 'recarregar o próprio resultado não dá erro');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed' and actor_id = pg_temp.person('root_mgr') and target_id = pg_temp.person('root_mgr')), 1,
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
            (pg_temp.person('sp_mgr'), pg_temp.person('sp_mgr'), null, null, null, null, null, null),
            (pg_temp.person('root_mgr'), pg_temp.person('p_mg'), null, null, null, null, null, null),
            (pg_temp.person('root_mgr'), pg_temp.person('p_sp'), null, null, null, null, null, null),
            (pg_temp.person('root_mgr'), pg_temp.person('root_mgr'), null, null, null, null, null, null) $$,
  'o evento guarda só quem viu e de quem (nada de conteúdo, casa, totem, notas nem termo)');

-- Quem lê o evento: só a coordenação nacional.
set local role authenticated;
select pg_temp.login('root_mgr');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_result_viewed'), 5, 'a coordenação nacional lê os eventos');
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
