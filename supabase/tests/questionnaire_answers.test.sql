-- Últimas respostas do questionário, cifradas (ADR 0014, #256): `answers_enc` junto do resultado, coberto pela assinatura do
-- servidor, sem leitura pela API (coluna sem grant), só a própria pessoa as lê por função definer (o servidor decifra), a
-- coordenação continua sem ver respostas individuais. Pessoas fictícias, só nesta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
insert into app.server_secrets (name, value) values ('questionnaire_signing_key', 'chave-de-teste-do-servidor-com-32-ou-mais')
on conflict (name) do update set value = excluded.value;
create temp table signing_key (k text);
insert into signing_key values ('chave-de-teste-do-servidor-com-32-ou-mais');
grant select on signing_key to anon, authenticated;
create function pg_temp.sig(p_message text) returns text language sql stable as $$
  select encode(extensions.hmac(convert_to(p_message, 'utf8'), convert_to((select k from signing_key), 'utf8'), 'sha256'), 'hex')
$$;
create function pg_temp.now_s() returns bigint language sql stable as $$ select extract(epoch from now())::bigint $$;
-- Como a server action: assina o resultado (com as respostas cifradas, se houver) para a pessoa da sessão.
create function pg_temp.record(p_answers text default null, p_sign_answers boolean default true) returns void language sql as $$
  select public.record_questionnaire_result('termo-1', 'casa-t1', pg_temp.enc('AB'), pg_temp.enc('SC'), pg_temp.now_s(),
    pg_temp.sig(format('result|%s|termo-1|casa-t1|%s|%s|%s', (select auth.uid()), pg_temp.enc('AB'), pg_temp.enc('SC'), pg_temp.now_s())
      || case when p_answers is not null and p_sign_answers then '|' || p_answers else '' end),
    p_answers)
$$;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2'), ('00000000-0000-0000-0000-0000000000c3');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version, status, access_status)
select id, pg_temp.enc('n'), 3550308, 'v1', 'active', 'active' from auth.users where id::text like '00000000-0000-0000-0000-0000000000c%';
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles;
insert into app.questionnaire_term_versions (version) values ('termo-1') on conflict do nothing;
insert into public.houses (key, active) values ('casa-t1', true) on conflict (key) do update set active = true;
insert into public.questionnaire_consents (profile_id, term_version) select id, 'termo-1' from public.profiles;
-- c3: coordenação nacional (gestora da raiz, com casa aceita para valer como membro de verdade).
insert into public.role_assignments (profile_id, role, unit_id) select '00000000-0000-0000-0000-0000000000c3', 'manager', id from public.units where path::text = 'br';
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values ('00000000-0000-0000-0000-0000000000c3', 'casa-t1', 'self', now());

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select pg_temp.record(pg_temp.enc('RESPOSTAS1')) $$, 'grava o resultado com as respostas cifradas, assinadas');
reset role;
select is((select answers_enc from public.questionnaire_results where profile_id = '00000000-0000-0000-0000-0000000000c1'), pg_temp.enc('RESPOSTAS1'),
  '... e as respostas ficam cifradas na linha do resultado');
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select pg_temp.record(pg_temp.enc('OUTRAS'), false) $$, '42501', null, 'a assinatura cobre as respostas cifradas: valor fora da assinatura é recusado');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t1', pg_temp.enc('AB'), pg_temp.enc('SC'), pg_temp.now_s(),
    pg_temp.sig(format('result|%s|termo-1|casa-t1|%s|%s|%s|%s', (select auth.uid()), pg_temp.enc('AB'), pg_temp.enc('SC'), pg_temp.now_s(), '{"q01":-5}')), '{"q01":-5}') $$, '22023', null,
  'respostas em texto puro (não cifradas) são recusadas, mesmo assinadas');
select throws_ok(format($$ select pg_temp.record(%L) $$, 'v1.AAAAAAAAAAAAAAAA.' || repeat('Z', 5000)), '22023', null, 'respostas cifradas grandes demais são recusadas');
select lives_ok($$ select pg_temp.record() $$, 'um novo resultado sem respostas substitui o anterior');
reset role;
select is((select answers_enc from public.questionnaire_results where profile_id = '00000000-0000-0000-0000-0000000000c1'), null, '... e as respostas somem (só a última resposta válida fica)');
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select pg_temp.record(pg_temp.enc('RESPOSTAS2')) $$, 'grava de novo com respostas');

-- Sem leitura pela API: nem a própria pessoa nem a coordenação leem a coluna; as outras colunas seguem como hoje.
select throws_ok($$ select answers_enc from public.questionnaire_results $$, '42501', null, 'a própria pessoa NÃO lê a coluna answers_enc pela API');
select lives_ok($$ select totem_enc, scores_enc from public.questionnaire_results $$, '... mas segue lendo as outras colunas do próprio resultado');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select answers_enc from public.questionnaire_results $$, '42501', null, 'a coordenação nacional NÃO lê respostas individuais');
select is((select count(*)::int from (select totem_enc from public.questionnaire_results) as x), 1, '... e segue lendo o que já lia (o resultado)');

-- Só a própria pessoa, pela função definer, para o servidor decifrar.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(public.own_questionnaire_answers_enc(), pg_temp.enc('RESPOSTAS2'), 'a pessoa lê as próprias respostas cifradas pela função (o servidor as decifra)');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(public.own_questionnaire_answers_enc(), null, 'outra pessoa (sem resultado) recebe nulo, nunca as respostas de alguém');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(public.own_questionnaire_answers_enc(), null, 'a coordenação também só vê as próprias (nenhuma)');
reset role;
select is(has_function_privilege('anon', 'public.own_questionnaire_answers_enc()', 'execute'), false, 'anon não executa a função das respostas');

-- Um resultado decidido pela coordenação (sem respostas) apaga as antigas: nunca ficam respostas de resultado que já não vale.
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
reset role;
update public.questionnaire_results set source = 'analysis', created_at = now() + interval '1 second' where profile_id = '00000000-0000-0000-0000-0000000000c1';
select is((select answers_enc from public.questionnaire_results where profile_id = '00000000-0000-0000-0000-0000000000c1'), null,
  'resultado reescrito (ex.: decidido pela coordenação) sem respostas novas apaga as antigas');

-- Some com a conta.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.questionnaire_results where profile_id = '00000000-0000-0000-0000-0000000000c1'), 0, 'as respostas somem com a conta (cascata)');

select * from finish();
rollback;
