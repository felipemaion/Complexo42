-- Renomear a chave de uma casa (issue #193): `app.rename_house_key(antiga, nova)` leva junto tudo
-- que aponta para ela (vínculos, papéis de coordenador, resultados do questionário e o log de
-- auditoria, que é só de inserção e por isso é religado de forma explícita), sem apagar nada e sem
-- recriar o banco. E depois das migrations, nada aponta para as casas de exemplo antigas.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Nenhuma coluna que guarda a chave de uma casa aponta mais para casa-exemplo-* (o seed e a
-- migration já usam os ids reais).
select ok(not exists (select 1 from public.houses where key like 'casa-exemplo-%'), 'houses: sem casa-exemplo-*');
select ok(not exists (select 1 from public.house_members where house_key like 'casa-exemplo-%'), 'house_members: sem casa-exemplo-*');
select ok(not exists (select 1 from public.role_assignments where house_key like 'casa-exemplo-%'), 'role_assignments: sem casa-exemplo-*');
select ok(not exists (select 1 from public.questionnaire_results where house_key like 'casa-exemplo-%'), 'questionnaire_results: sem casa-exemplo-*');
select ok(not exists (select 1 from public.audit_log where house_key like 'casa-exemplo-%'), 'audit_log: sem casa-exemplo-*');
select set_eq($$ select key from public.houses $$, array['esparta', 'atenas', 'alexandria', 'siracusa'], 'as casas do banco são as quatro reais');

-- A função não é chamável pela API.
set local role anon;
select throws_ok($$ select app.rename_house_key('x-velha', 'x-nova') $$, '42501', null, 'anônimo NÃO renomeia casa');
set local role authenticated;
select throws_ok($$ select app.rename_house_key('x-velha', 'x-nova') $$, '42501', null, 'pessoa logada NÃO renomeia casa');
reset role;

-- Cenário: uma casa antiga com dados em todas as tabelas.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'm1@exemplo.org'),
  ('00000000-0000-0000-0000-0000000000b2', 'm2@exemplo.org');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version, access_status, status)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1', 'active', 'active' from auth.users where email in ('m1@exemplo.org', 'm2@exemplo.org');
insert into app.questionnaire_term_versions (version) values ('termo-r') on conflict do nothing;
insert into public.houses (key, active) values ('casa-velha', false);
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
values ('00000000-0000-0000-0000-0000000000b1', 'casa-velha', 'self', now());
insert into public.role_assignments (profile_id, role, unit_id, house_key)
select '00000000-0000-0000-0000-0000000000b2', 'house_coordinator', id, 'casa-velha' from public.units where parent_id is null;
insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source)
values ('00000000-0000-0000-0000-0000000000b1', 'termo-r', 'casa-velha', 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 'questionnaire');
insert into public.audit_log (actor_id, event, target_id, reason, house_key)
values ('00000000-0000-0000-0000-0000000000b1', 'house_accepted', '00000000-0000-0000-0000-0000000000b1', 'self', 'casa-velha');

select lives_ok($$ select app.rename_house_key('casa-velha', 'casa-nova') $$, 'renomeia a casa');
select results_eq($$ select key, active from public.houses where key like 'casa-%' order by key $$,
  $$ values ('casa-nova'::text, false) $$, 'a casa nova herda a situação (inativa) e a antiga some');
select is((select house_key from public.house_members where profile_id = '00000000-0000-0000-0000-0000000000b1'), 'casa-nova', 'o vínculo foi junto');
select is((select house_key from public.role_assignments where profile_id = '00000000-0000-0000-0000-0000000000b2'), 'casa-nova', 'o papel de coordenador foi junto');
select is((select house_key from public.questionnaire_results where profile_id = '00000000-0000-0000-0000-0000000000b1'), 'casa-nova', 'o resultado foi junto');
select is((select count(*)::int from public.audit_log where house_key = 'casa-nova'), 1, 'o log de auditoria também (religado de forma explícita)');
select throws_ok($$ update public.audit_log set reason = 'self' $$, '42501', null, 'e o log voltou a ser só de inserção (o trigger foi religado)');
-- Idempotente: repetir, ou renomear o que não existe, não faz nada.
select lives_ok($$ select app.rename_house_key('casa-velha', 'casa-nova') $$, 'repetir é inofensivo');

select * from finish();
rollback;
