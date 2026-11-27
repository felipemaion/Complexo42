-- Perfil incompleto (ADR 0017, base do "casa antes de tudo"): a linha de `profiles` nasce no primeiro login de quem
-- tem acesso liberado, sem nome nem município; os nulos só valem enquanto `profile_completed_at` é nulo, e ninguém
-- volta a incompleto. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(49);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- c1: na lista de autorizados; c2: fora da lista; c3: com perfil completo (migração dos já existentes).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3');
insert into public.consent_acceptances (user_id, version)
select id, 'v1' from auth.users where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3');
insert into public.access_allowlist (email_hmac, source) values (repeat('1', 64), 'manual');

-- ---------------------------------------------------------------------------------------
-- A linha nasce no primeiro login, só de quem tem acesso liberado
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(public.resolve_access(repeat('1', 64)), 'active', 'quem está na lista é liberado no primeiro login, mesmo sem perfil');
select results_eq(
  $$ select display_name_enc is null, municipality_code is null, state_code is null, profile_completed_at is null, access_status, status
     from public.profiles where id = '00000000-0000-0000-0000-0000000000c1' $$,
  $$ values (true, true, true, true, 'active'::text, 'active'::text) $$,
  'a linha nasce incompleta (sem nome, município nem UF), ativa');
select is(public.resolve_access(repeat('1', 64)), 'active', 'chamar de novo é idempotente');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 1, '... e não duplica a linha');

select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(public.resolve_access(repeat('2', 64)), null, 'quem não está na lista NÃO ganha linha (segue o caminho de hoje: perfil e espera)');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 0, '... nenhuma linha para quem não tem acesso liberado');

-- ---------------------------------------------------------------------------------------
-- Completar o perfil: só por save_own_profile
-- ---------------------------------------------------------------------------------------
reset role;
insert into public.houses (key, active) values ('casa-t1', true) on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values ('00000000-0000-0000-0000-0000000000c1', 'casa-t1', 'self', now());
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  public.save_own_profile(pg_temp.enc('c1'), 3550308, null, pg_temp.enc('wa'), repeat('a', 64), null, null),
  'saved', 'a pessoa de perfil incompleto o completa pela função');
select results_eq(
  $$ select display_name_enc = pg_temp.enc('c1'), municipality_code, state_code::text, profile_completed_at is not null, consent_version
     from public.profiles where id = '00000000-0000-0000-0000-0000000000c1' $$,
  $$ values (true, 3550308, 'SP'::text, true, 'v1'::text) $$,
  '... nome, município, UF e versão do termo gravados e o perfil marcado como completo');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(public.save_own_profile(pg_temp.enc('c3'), 3550308, null, pg_temp.enc('wa'), repeat('b', 64), null, null), 'saved',
  'quem não tinha linha cria e completa o perfil num passo só (caminho de hoje)');
select is((select profile_completed_at is not null from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'), true, '... marcado como completo');

-- ---------------------------------------------------------------------------------------
-- Restrições: nulos só enquanto incompleto; ninguém volta a incompleto
-- ---------------------------------------------------------------------------------------
reset role;
select lives_ok($$ insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c4');
                   insert into public.profiles (id, status, access_status) values ('00000000-0000-0000-0000-0000000000c4', 'active', 'active') $$,
  'a tabela aceita a linha incompleta (nulos enquanto incompleto)');
select throws_ok($$ update public.profiles set display_name_enc = null where id = '00000000-0000-0000-0000-0000000000c1' $$, '23514', null,
  'perfil completo NÃO aceita nome nulo');
select throws_ok($$ update public.profiles set municipality_code = null where id = '00000000-0000-0000-0000-0000000000c1' $$, '23514', null,
  'perfil completo NÃO aceita município nulo');
select throws_ok($$ update public.profiles set profile_completed_at = null where id = '00000000-0000-0000-0000-0000000000c1' $$, '23514', null,
  'perfil completo NÃO volta a incompleto');
select throws_ok($$ update public.profiles set profile_completed_at = now() where id = (select id from public.profiles where id = '00000000-0000-0000-0000-0000000000c4') $$, '23514', null,
  'perfil incompleto NÃO pode ser marcado completo sem nome e município');
-- Linha gravada já com tudo (fixtures, scripts, SQL direto): nasce completa. Faltando qualquer campo, fica incompleta.
select lives_ok($$ insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c5'), ('00000000-0000-0000-0000-0000000000c6');
                   insert into public.profiles (id, display_name_enc, municipality_code, consent_version, status, access_status)
                   values ('00000000-0000-0000-0000-0000000000c5', pg_temp.enc('c5'), 3550308, 'v1', 'active', 'active'),
                          ('00000000-0000-0000-0000-0000000000c6', pg_temp.enc('c6'), null, 'v1', 'active', 'active') $$,
  'inserir com e sem município');
select results_eq($$ select id::text, profile_completed_at is not null from public.profiles
                     where id in ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000c6') order by id $$,
  $$ values ('00000000-0000-0000-0000-0000000000c5'::text, true), ('00000000-0000-0000-0000-0000000000c6'::text, false) $$,
  'com nome, município e termo a linha nasce completa; sem município, incompleta');

-- ---------------------------------------------------------------------------------------
-- Exportação ("Baixar meus dados") de quem tem perfil incompleto: não quebra
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select lives_ok($$ select public.export_own_data() $$, 'exportar com perfil incompleto não quebra');
select is((public.export_own_data() -> 'profile' ->> 'profile_completed_at'), null, '... e o perfil sai marcado como incompleto');

-- ---------------------------------------------------------------------------------------
-- Dois predicados (revisão do #227): a linha incompleta já `active` NÃO vale como membro
-- ---------------------------------------------------------------------------------------
reset role;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-0000000000d3'), ('00000000-0000-0000-0000-0000000000d4');
-- d1: linha incompleta ativa, SEM termo; d2: incompleta ativa, COM termo; d3: perfil completo ativo, SEM termo;
-- d4: perfil completo ativo, COM termo (o membro de verdade).
insert into public.profiles (id, status, access_status) values
  ('00000000-0000-0000-0000-0000000000d1', 'active', 'active'), ('00000000-0000-0000-0000-0000000000d2', 'active', 'active');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version, status, access_status) values
  ('00000000-0000-0000-0000-0000000000d3', pg_temp.enc('d3'), 3550308, 'v1', 'active', 'active'),
  ('00000000-0000-0000-0000-0000000000d4', pg_temp.enc('d4'), 3550308, 'v1', 'active', 'active');
insert into public.consent_acceptances (user_id, version) values
  ('00000000-0000-0000-0000-0000000000d2', 'v1'), ('00000000-0000-0000-0000-0000000000d4', 'v1');
insert into app.questionnaire_term_versions (version) values ('termo-1') on conflict do nothing;
insert into public.houses (key, active) values ('casa-t1', true) on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values ('00000000-0000-0000-0000-0000000000d4', 'casa-t1', 'self', now());
set local role authenticated;

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is(app.is_onboarding_member(), true, 'linha incompleta ativa vale como membro de entrada (is_onboarding_member)');
select is(app.is_active_member(), false, '... mas NÃO como membro de verdade (is_active_member)');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select is(app.is_active_member(), false, 'termo aceito mas perfil incompleto: ainda NÃO é membro de verdade');
select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select is(app.is_active_member(), false, 'perfil completo mas sem o termo vigente: NÃO é membro de verdade');
select pg_temp.login('00000000-0000-0000-0000-0000000000d4');
select is(app.is_active_member(), true, 'perfil completo e termo vigente: é membro de verdade');
select ok((select count(*) from public.units) > 0, 'o membro de verdade lê a estrutura (unidades)');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.units), 0, 'a linha incompleta NÃO lê a estrutura (unidades)');
select is((select count(*)::int from public.profiles), 1, '... nem os perfis dos outros (só a própria linha)');

-- O que a pessoa faz ANTES de ter casa continua funcionando só com o predicado de entrada.
select ok((select count(*) from public.houses) > 0, 'a linha incompleta lê as casas (escolha da casa)');
select lives_ok($$ select public.record_questionnaire_consent('termo-1') $$, 'a linha incompleta aceita o termo do questionário');
select lives_ok($$ select public.export_own_data() $$, '... e baixa os próprios dados');

-- ---------------------------------------------------------------------------------------
-- consent_at não é gravado em linha incompleta; completar usa o termo exigido agora
-- ---------------------------------------------------------------------------------------
reset role;
select is((select consent_at is null from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'), true,
  'a linha incompleta não grava consent_at falso');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d5');
insert into public.profiles (id, consent_version, status, access_status) values ('00000000-0000-0000-0000-0000000000d5', 'v0-velho', 'active', 'active');
insert into public.consent_acceptances (user_id, version) values ('00000000-0000-0000-0000-0000000000d5', 'v1');
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values ('00000000-0000-0000-0000-0000000000d5', 'casa-t1', 'self', now());
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000d5');
select is(public.save_own_profile(pg_temp.enc('d5'), 3550308, null, pg_temp.enc('wa'), repeat('d', 64), null, null), 'saved', 'completa a linha incompleta');
select results_eq($$ select consent_version, consent_at is not null from public.profiles where id = '00000000-0000-0000-0000-0000000000d5' $$,
  $$ values ('v1'::text, true) $$,
  'ao completar, a versão do termo é a exigida agora (não uma velha que a linha trazia) e consent_at é gravado');

-- ---------------------------------------------------------------------------------------
-- Quem não está liberado NÃO usa a entrada (accept_house, termo do questionário, questionário)
-- ---------------------------------------------------------------------------------------
reset role;
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'), ('00000000-0000-0000-0000-0000000000a4');
-- a1: na espera; a2: bloqueada; a3: conta suspensa; a4: sem linha (fora da lista de autorizados).
insert into public.profiles (id, status, access_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'pending', 'waitlisted'),
  ('00000000-0000-0000-0000-0000000000a2', 'pending', 'blocked'),
  ('00000000-0000-0000-0000-0000000000a3', 'suspended', 'active');
insert into public.consent_acceptances (user_id, version)
select id, 'v1' from auth.users where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.accept_house('casa-t1', 'self', null) $$, '42501', null, 'na espera: accept_house recusado');
select throws_ok($$ select public.record_questionnaire_consent('termo-1') $$, '42501', null, 'na espera: termo do questionário recusado');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t1', pg_temp.enc('AB'), pg_temp.enc('SC'), 0, 'x') $$, '42501', 'só quem está ativo usa o questionário', 'na espera: questionário recusado (lock_active_caller)');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.accept_house('casa-t1', 'self', null) $$, '42501', null, 'bloqueada: accept_house recusado');
select throws_ok($$ select public.record_questionnaire_consent('termo-1') $$, '42501', null, 'bloqueada: termo do questionário recusado');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t1', pg_temp.enc('AB'), pg_temp.enc('SC'), 0, 'x') $$, '42501', 'só quem está ativo usa o questionário', 'bloqueada: questionário recusado (lock_active_caller)');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.accept_house('casa-t1', 'self', null) $$, '42501', null, 'conta suspensa: accept_house recusado');
select throws_ok($$ select public.record_questionnaire_consent('termo-1') $$, '42501', null, 'conta suspensa: termo do questionário recusado');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t1', pg_temp.enc('AB'), pg_temp.enc('SC'), 0, 'x') $$, '42501', 'só quem está ativo usa o questionário', 'conta suspensa: questionário recusado (lock_active_caller)');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.accept_house('casa-t1', 'self', null) $$, '42501', null, 'sem linha (fora da lista): accept_house recusado');
select throws_ok($$ select public.record_questionnaire_consent('termo-1') $$, '42501', null, 'sem linha: termo do questionário recusado');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t1', pg_temp.enc('AB'), pg_temp.enc('SC'), 0, 'x') $$, '42501', 'só quem está ativo usa o questionário', 'sem linha: questionário recusado (lock_active_caller)');

-- A linha incompleta (d2: ativa, com termo) não lê contato, auditoria, delegação nem resultados/coordenação.
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.profile_contacts), 0, 'a linha incompleta NÃO lê contatos');
select is((select count(*)::int from public.audit_log where actor_id is distinct from '00000000-0000-0000-0000-0000000000d2'), 0, '... nem a auditoria dos outros (só os próprios eventos de entrada)');
select is((select count(*)::int from public.questionnaire_data_grants), 0, '... nem as delegações');
select is((select count(*)::int from public.questionnaire_results) + (select count(*)::int from public.house_analysis_requests), 0, '... nem os resultados e pedidos do questionário (cortes da coordenação)');

select * from finish();
rollback;
