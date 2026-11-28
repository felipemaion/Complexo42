-- Medalha do totem visível aos membros (issue #303, ADR 0014 revisão de 28/11): `public.member_totems`
-- devolve a quem é membro ativo SÓ o totem CIFRADO (id e valor) de pessoas ativas. Nada de notas, respostas,
-- assinatura nem casa sugerida; quem decifra é o servidor do app, com a chave dele. A RLS de
-- `questionnaire_results` não muda. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('a',    '00000000-0000-0000-0000-0000000000b1', 'a@exemplo.org'),    -- membro ativo, com totem
  ('b',    '00000000-0000-0000-0000-0000000000b2', 'b@exemplo.org'),    -- membro ativo, com totem
  ('pend', '00000000-0000-0000-0000-0000000000b3', 'pend@exemplo.org'), -- membro ativo, totem pendente (nulo)
  ('wl',   '00000000-0000-0000-0000-0000000000b4', 'wl@exemplo.org'),   -- na espera, com resultado
  ('susp', '00000000-0000-0000-0000-0000000000b5', 'susp@exemplo.org'), -- suspenso, com resultado
  ('onb',  '00000000-0000-0000-0000-0000000000b6', 'onb@exemplo.org'),  -- liberado, sem casa aceita ainda (não é membro)
  ('none', '00000000-0000-0000-0000-0000000000b7', 'none@exemplo.org'); -- membro ativo, sem resultado
insert into auth.users (id, email) select id, email from people;
create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.enc(p_tag text) returns text language sql as $$ select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'Z') $$;
grant select on people to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people where name <> 'wl');
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('wl');
update public.profiles set status = 'suspended' where id = pg_temp.person('susp');

insert into public.houses (key, active) values ('casa-x', true) on conflict do nothing;
-- Membro de verdade exige a casa aceita (ADR 0017). `onb` fica sem.
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'casa-x', 'self', now() from people where name in ('a', 'b', 'pend', 'none', 'wl', 'susp');

insert into app.questionnaire_term_versions (version) values ('termo-1') on conflict do nothing;
insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source, totem_state) values
  (pg_temp.person('a'), 'termo-1', 'casa-x', pg_temp.enc('TA'), 'questionnaire', 'decided'),
  (pg_temp.person('b'), 'termo-1', 'casa-x', pg_temp.enc('TB'), 'questionnaire', 'decided'),
  (pg_temp.person('pend'), 'termo-1', 'casa-x', null, 'questionnaire', 'pending'),
  (pg_temp.person('wl'), 'termo-1', 'casa-x', pg_temp.enc('TW'), 'questionnaire', 'decided'),
  (pg_temp.person('susp'), 'termo-1', 'casa-x', pg_temp.enc('TS'), 'questionnaire', 'decided');

-- ---------------------------------------------------------------------------------------
-- Forma e privilégios
-- ---------------------------------------------------------------------------------------
select has_function('public', 'member_totems', array['uuid[]'], 'a função existe');
select is(pg_get_function_result('public.member_totems(uuid[])'::regprocedure), 'TABLE(profile_id uuid, totem_enc text)',
  'devolve só o id e o totem cifrado: nada de notas, respostas, assinatura nem casa sugerida');
select ok(not has_function_privilege('anon', 'public.member_totems(uuid[])', 'execute'), 'anon não executa');
select ok(has_function_privilege('authenticated', 'public.member_totems(uuid[])', 'execute'), 'authenticated executa (o corte é feito dentro)');

-- ---------------------------------------------------------------------------------------
-- Quem chama: só membro ativo
-- ---------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select * from public.member_totems(array[pg_temp.person('a')]) $$, '42501', null, 'anônimo NÃO lê');
set local role authenticated;
select pg_temp.login('wl');
select throws_ok($$ select * from public.member_totems(array[pg_temp.person('a')]) $$, '42501', null, 'quem está na espera NÃO lê');
select pg_temp.login('onb');
select throws_ok($$ select * from public.member_totems(array[pg_temp.person('a')]) $$, '42501', null, 'liberado, mas ainda sem casa aceita (não é membro): NÃO lê');

-- ---------------------------------------------------------------------------------------
-- O que o membro ativo recebe
-- ---------------------------------------------------------------------------------------
select pg_temp.login('a');
select is(
  (select count(*)::int from public.member_totems(array[pg_temp.person('a'), pg_temp.person('b')])), 2,
  'o membro ativo lê o totem dele e o de outro membro ativo');
select is(
  (select totem_enc from public.member_totems(array[pg_temp.person('b')])), pg_temp.enc('TB'),
  'o valor é o cifrado, como está no banco (quem decifra é o servidor do app)');
select is(
  (select count(*)::int from public.member_totems(array[pg_temp.person('pend'), pg_temp.person('none')])), 0,
  'totem pendente e quem não tem resultado: sem linha');
select is(
  (select count(*)::int from public.member_totems(array[pg_temp.person('wl'), pg_temp.person('susp')])), 0,
  'pessoa na espera ou suspensa: sem linha');
select is(
  (select count(*)::int from public.member_totems(array[pg_temp.person('b'), pg_temp.person('b'), pg_temp.person('b')])), 1,
  'id repetido vira uma linha só');
select throws_ok($$ select * from public.member_totems(null) $$, '22023', null, 'lista nula é recusada');
select throws_ok(
  $$ select * from public.member_totems((select array_agg(gen_random_uuid()) from generate_series(1, 201))) $$,
  '22023', null, 'mais de 200 ids é recusado');

-- ---------------------------------------------------------------------------------------
-- A RLS da tabela não mudou: as linhas dos outros seguem invisíveis por ela
-- ---------------------------------------------------------------------------------------
select is((select count(*)::int from public.questionnaire_results where profile_id = pg_temp.person('b')), 0,
  'o membro NÃO lê a linha do outro pela tabela (só o totem cifrado, pela função)');
select is((select count(*)::int from public.questionnaire_results where profile_id = pg_temp.person('a')), 1, 'a própria linha segue legível');

select * from finish();
rollback;
