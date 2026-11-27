-- Chave nova do questionário das casas (issue #172, ADR 0014): `questionnaire_results` (casa
-- sugerida e totem CIFRADO), `house_analysis_requests` (fila do resultado inconclusivo, respostas
-- cifradas), as funções `record_questionnaire_result`, `request_house_analysis` e
-- `resolve_house_analysis`, a auditoria, o apagamento das respostas e a delegação do acesso
-- (`questionnaire_data_grants`). Pessoas fictícias, só dentro desta transação. O banco não
-- decifra: os testes usam valores no formato v1.<iv>.<ct> que estão no lugar do cifrado.
begin;
create extension if not exists pgtap with schema extensions;

select plan(149);

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select slug, id from public.units where path::text in ('br', 'br.sp');
create function pg_temp.unit(p_slug text) returns uuid language sql stable as $$
  select id from unit_ids where slug = p_slug
$$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000f1', 'root.mgr@exemplo.org'), -- coordenação nacional
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000f2', 'sp.mgr@exemplo.org'),   -- gestor de SP (não nacional)
  ('hc_root',  '00000000-0000-0000-0000-0000000000f3', 'hc.root@exemplo.org'),  -- coordenador nacional de casa
  ('p1',       '00000000-0000-0000-0000-0000000000f4', 'p1@exemplo.org'),       -- ativa
  ('p2',       '00000000-0000-0000-0000-0000000000f5', 'p2@exemplo.org'),       -- ativa
  ('p3',       '00000000-0000-0000-0000-0000000000f6', 'p3@exemplo.org'),       -- ativa
  ('wait',     '00000000-0000-0000-0000-0000000000f7', 'wait@exemplo.org'),     -- na espera
  ('abc_mgr',  '00000000-0000-0000-0000-0000000000f8', 'abc.mgr@exemplo.org');  -- gestor da incubadora ABC (delegação)
insert into auth.users (id, email) select id, email from people;

create function pg_temp.person(p_name text) returns uuid language plpgsql stable as $$
declare
  found_id uuid;
begin
  select id into found_id from people where name = p_name;
  if found_id is null then
    raise exception 'pessoa de teste desconhecida: %', p_name using errcode = 'no_data_found';
  end if;
  return found_id;
end;
$$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people, unit_ids to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people);
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('wait');

insert into public.houses (key, active) values ('casa-t1', true), ('casa-t2', true), ('casa-off', false)
on conflict (key) do update set active = excluded.active;
insert into app.questionnaire_term_versions (version) values ('termo-1') on conflict do nothing;
insert into public.role_assignments (profile_id, role, unit_id, house_key) values
  (pg_temp.person('hc_root'), 'house_coordinator', pg_temp.unit('br'), 'casa-t1');
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('sp'));

-- Aceite do termo das pessoas que respondem (a espera também, para provar que é o status que barra).
insert into public.questionnaire_consents (profile_id, term_version)
select id, 'termo-1' from people where name in ('p1', 'p2', 'p3', 'wait');


-- Assinatura do servidor (ADR 0014): a mesma chave do banco, num temp para o teste assinar como o app.
insert into app.server_secrets (name, value) values ('questionnaire_signing_key', 'chave-de-teste-do-servidor-com-32-ou-mais')
on conflict (name) do update set value = excluded.value;
create temp table signing_key (k text);
insert into signing_key values ('chave-de-teste-do-servidor-com-32-ou-mais');
grant select on signing_key to anon, authenticated;
create function pg_temp.sig(p_message text, p_key text default null) returns text language sql stable as $$
  select encode(extensions.hmac(convert_to(p_message, 'utf8'), convert_to(coalesce(p_key, (select k from signing_key)), 'utf8'), 'sha256'), 'hex')
$$;
create function pg_temp.now_s() returns bigint language sql stable as $$ select extract(epoch from now())::bigint $$;
-- Valor no formato do cifrado (v1.<iv>.<ct>) que carrega um rótulo legível: o banco só confere o
-- formato e a assinatura, quem decifra é o servidor do app (ADR 0003).
create function pg_temp.enc(p_label text) returns text language sql immutable as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || case when length(p_label) >= 22 then p_label else rpad(p_label, 22, 'Z') end
$$;
-- Como a server action: assina para a pessoa da sessão e chama a função do banco.
-- `p_totem_value` é o valor que vai no parâmetro (normalmente enc('AB')).
create function pg_temp.record_raw(p_term text, p_house text, p_totem_value text, p_age_s bigint default 0) returns void language sql as $$
  select public.record_questionnaire_result(p_term, p_house, p_totem_value, pg_temp.now_s() - p_age_s,
    pg_temp.sig(format('result|%s|%s|%s|%s|%s', (select auth.uid()), p_term, p_house, p_totem_value, pg_temp.now_s() - p_age_s)))
$$;
create function pg_temp.record(p_term text, p_house text, p_totem text, p_age_s bigint default 0) returns void language sql as $$
  select pg_temp.record_raw(p_term, p_house, pg_temp.enc(p_totem), p_age_s)
$$;
create function pg_temp.analyze_raw(p_term text, p_axes text[], p_answers_value text) returns uuid language sql as $$
  select public.request_house_analysis(p_term, p_axes, p_answers_value, pg_temp.now_s(),
    pg_temp.sig(format('analysis|%s|%s|%s|%s|%s', (select auth.uid()), p_term, array_to_string(p_axes, ','), p_answers_value, pg_temp.now_s())))
$$;
create function pg_temp.analyze(p_term text, p_axes text[], p_answers text) returns uuid language sql as $$
  select pg_temp.analyze_raw(p_term, p_axes, pg_temp.enc(p_answers))
$$;

create function pg_temp.results_seen() returns int language sql stable as $$
  select count(*)::int from public.questionnaire_results
$$;
create function pg_temp.requests_seen() returns int language sql stable as $$
  select count(*)::int from public.house_analysis_requests
$$;
create function pg_temp.open_request_of(p_name text) returns uuid language sql stable as $$
  select id from public.house_analysis_requests where profile_id = pg_temp.person(p_name) and status = 'open'
$$;
grant execute on function pg_temp.results_seen(), pg_temp.requests_seen() to authenticated;

-- ---------------------------------------------------------------------------------------
-- record_questionnaire_result
-- ---------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select pg_temp.record('termo-1', 'casa-t1', 'AB') $$, '42501', null,
  'anônimo NÃO grava resultado');

set local role authenticated;
select pg_temp.login('wait');
select throws_ok($$ select pg_temp.record('termo-1', 'casa-t1', 'AB') $$, '42501', null,
  'quem está na espera NÃO grava resultado');

select pg_temp.login('p1');
select throws_ok($$ select pg_temp.record_raw('termo-1', 'casa-t1', 'AB') $$, '22023', null,
  'totem em texto puro (não cifrado) é recusado, mesmo assinado');
select throws_ok($$ select pg_temp.record_raw('termo-1', 'casa-t1', 'v1.curto') $$, '22023', null,
  'valor fora do formato cifrado é recusado');
select throws_ok($$ select pg_temp.record('termo-9', 'casa-t1', 'AB') $$, '22023', null,
  'sem o aceite dessa versão do termo, é recusado');
select throws_ok($$ select pg_temp.record('termo-1', 'casa-nao-existe', 'AB') $$, 'P0002', null,
  'casa inexistente é recusada');
select throws_ok($$ select pg_temp.record('termo-1', 'casa-off', 'AB') $$, 'P0002', null,
  'casa inativa é recusada');
select is(pg_temp.results_seen(), 0, 'as recusas não gravaram nada');

select lives_ok($$ select pg_temp.record('termo-1', 'casa-t1', 'AB') $$,
  'a própria pessoa grava o resultado');
select is((select totem_enc from public.questionnaire_results), pg_temp.enc('AB'), 'a pessoa lê o próprio totem (cifrado)');
select lives_ok($$ select pg_temp.record('termo-1', 'casa-t2', 'BA') $$,
  'refazer o questionário substitui o resultado');
select results_eq($$ select house_key, totem_enc, source from public.questionnaire_results $$,
  $$ values ('casa-t2'::text, pg_temp.enc('BA'), 'questionnaire'::text) $$,
  'continua uma linha por pessoa, a mais recente');

select throws_ok($$ insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source)
                     values (pg_temp.person('p1'), 'termo-1', 'casa-t1', pg_temp.enc('AA'), 'questionnaire') $$, '42501', null,
  'NÃO grava direto na tabela (só pela função)');
select throws_ok($$ update public.questionnaire_results set totem_enc = pg_temp.enc('AA') $$, '42501', null,
  'NÃO altera direto na tabela');
select throws_ok($$ delete from public.questionnaire_results $$, '42501', null,
  'NÃO apaga direto da tabela');

-- ---------------------------------------------------------------------------------------
-- Quem lê o resultado: a pessoa e a coordenação nacional, ninguém mais
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p2');
select is(pg_temp.results_seen(), 0, 'outra pessoa NÃO lê o resultado');
select pg_temp.login('sp_mgr');
select is(pg_temp.results_seen(), 0, 'gestor de estado NÃO lê o totem (só a coordenação nacional)');
select pg_temp.login('hc_root');
select is(pg_temp.results_seen(), 0, 'coordenador nacional de casa NÃO lê o totem');
select pg_temp.login('root_mgr');
select is(pg_temp.results_seen(), 1, 'a coordenação nacional lê o resultado');
select is((select totem_enc from public.questionnaire_results), pg_temp.enc('BA'), '... com o totem (cifrado)');

-- A coordenação territorial e a da casa leem `house_members`, que NÃO traz o totem.
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'house_members' and column_name ~ 'totem'),
  0, 'house_members (lida pela coordenação de território e de casa) NÃO tem totem');

-- Quem está na espera some da leitura nacional.
reset role;
insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source)
values (pg_temp.person('wait'), 'termo-1', 'casa-t1', pg_temp.enc('AA'), 'questionnaire');
set local role authenticated;
select pg_temp.login('root_mgr');
select is(pg_temp.results_seen(), 1, 'a coordenação nacional NÃO lê o resultado de quem está na espera');
select pg_temp.login('wait');
select is(pg_temp.results_seen(), 0, 'quem está na espera NÃO lê nem o próprio resultado');

-- ---------------------------------------------------------------------------------------
-- request_house_analysis
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p1');
select throws_ok($$ select pg_temp.analyze('termo-1', array['house3'], 'resp1') $$, '22023', null,
  'eixo desconhecido é recusado');
select throws_ok($$ select pg_temp.analyze('termo-1', array[]::text[], 'resp1') $$, '22023', null,
  'lista de eixos vazia é recusada');
select throws_ok($$ select pg_temp.analyze_raw('termo-1', array['house1'], '{"q01": "a"}') $$, '22023', null,
  'respostas em texto puro (não cifradas) são recusadas, mesmo assinadas');
select throws_ok(format($$ select pg_temp.analyze_raw('termo-1', array['house1'], %L) $$, pg_temp.enc(repeat('Z', 9000))), '22023', null,
  'respostas cifradas grandes demais são recusadas');
select throws_ok($$ select pg_temp.analyze('termo-9', array['house1'], 'resp1') $$, '22023', null,
  'sem o aceite dessa versão do termo, é recusado');
select pg_temp.login('wait');
select throws_ok($$ select pg_temp.analyze('termo-1', array['house1'], 'resp1') $$, '42501', null,
  'quem está na espera NÃO abre pedido');

select pg_temp.login('p1');
select lives_ok($$ select pg_temp.analyze('termo-1', array['house1'], 'respA') $$,
  'a pessoa abre o pedido de análise');
select is(pg_temp.requests_seen(), 1, 'um pedido');
select is((select status from public.house_analysis_requests), 'open', 'o pedido está aberto');
select is((select answers_enc from public.house_analysis_requests), pg_temp.enc('respA'),
  'as respostas ficam guardadas (cifradas) enquanto o pedido está aberto');
select is(pg_temp.results_seen(), 0, 'o resultado anterior deixa de valer');
select throws_ok($$ select pg_temp.analyze('termo-1', array['house1', 'totem2'], 'respB') $$, '54000', null,
  'renovar o pedido logo em seguida é recusado (no máximo um por hora)');
reset role;
update public.house_analysis_requests set created_at = now() - interval '2 hours' where profile_id = pg_temp.person('p1');
set local role authenticated;
select pg_temp.login('p1');
select lives_ok($$ select pg_temp.analyze('termo-1', array['house1', 'totem2'], 'respB') $$,
  'passada 1 hora, refazer o questionário renova o pedido aberto');
select results_eq($$ select count(*)::int, min(tied_axes::text), min(answers_enc) from public.house_analysis_requests $$,
  $$ values (1, '{house1,totem2}'::text, pg_temp.enc('respB')) $$,
  'continua um pedido aberto por pessoa, com as respostas mais recentes');
select throws_ok($$ insert into public.house_analysis_requests (profile_id, term_version, tied_axes, answers_enc)
                     values (pg_temp.person('p1'), 'termo-1', array['house1'], pg_temp.enc('x')) $$, '42501', null,
  'NÃO grava direto na fila');

select pg_temp.login('p2');
select is(pg_temp.requests_seen(), 0, 'outra pessoa NÃO lê o pedido nem as respostas');
select pg_temp.login('sp_mgr');
select is(pg_temp.requests_seen(), 0, 'gestor de estado NÃO lê o pedido nem as respostas');
select pg_temp.login('hc_root');
select is(pg_temp.requests_seen(), 0, 'coordenador nacional de casa NÃO lê o pedido');
select pg_temp.login('root_mgr');
select is(pg_temp.requests_seen(), 1, 'a coordenação nacional lê o pedido');
select is((select answers_enc from public.house_analysis_requests), pg_temp.enc('respB'), '... e as respostas (cifradas)');
select is((select count(*)::int from public.audit_log where event = 'house_analysis_requested'), 1,
  'a coordenação nacional lê o evento de auditoria do pedido');
select pg_temp.login('p2');
select is((select count(*)::int from public.audit_log where event = 'house_analysis_requested'), 0,
  'outra pessoa NÃO lê o evento do pedido');

-- ---------------------------------------------------------------------------------------
-- resolve_house_analysis
-- ---------------------------------------------------------------------------------------
create temp table request_ids (id uuid);
reset role;
insert into request_ids select pg_temp.open_request_of('p1');
grant select on request_ids to authenticated;
set local role authenticated;

select pg_temp.login('p1');
select throws_ok($$ select public.resolve_house_analysis((select id from request_ids), 'casa-t1', pg_temp.enc('AB')) $$, '42501', null,
  'a própria pessoa NÃO resolve o pedido');
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.resolve_house_analysis((select id from request_ids), 'casa-t1', pg_temp.enc('AB')) $$, '42501', null,
  'gestor de estado NÃO resolve');
select pg_temp.login('hc_root');
select throws_ok($$ select public.resolve_house_analysis((select id from request_ids), 'casa-t1', pg_temp.enc('AB')) $$, '42501', null,
  'coordenador nacional de casa NÃO resolve');

select pg_temp.login('root_mgr');
select throws_ok($$ select public.resolve_house_analysis((select id from request_ids), 'casa-t1', 'AB') $$, '22023', null,
  'totem em texto puro é recusado');
select throws_ok($$ select public.resolve_house_analysis((select id from request_ids), 'casa-off', pg_temp.enc('AB')) $$, 'P0002', null,
  'casa inativa é recusada');
select throws_ok($$ select public.resolve_house_analysis(gen_random_uuid(), 'casa-t1', pg_temp.enc('AB')) $$, 'P0002', null,
  'pedido inexistente é recusado');
select lives_ok($$ select public.resolve_house_analysis((select id from request_ids), 'casa-t2', pg_temp.enc('BB')) $$,
  'a coordenação nacional resolve o pedido');
select results_eq($$ select status, resolution, answers_enc is null, resolved_by = pg_temp.person('root_mgr')
                     from public.house_analysis_requests $$,
  $$ values ('resolved'::text, 'coordination'::text, true, true) $$,
  'resolvido: as respostas foram apagadas e quem resolveu ficou registrado');
select results_eq($$ select house_key, totem_enc, source from public.questionnaire_results
                     where profile_id = pg_temp.person('p1') $$,
  $$ values ('casa-t2'::text, pg_temp.enc('BB'), 'analysis'::text) $$,
  'a decisão vira o resultado da pessoa');
select is((select count(*)::int from public.audit_log where event = 'house_analysis_resolved' and target_id = pg_temp.person('p1')), 1,
  'a resolução é auditada');
select throws_ok($$ select public.resolve_house_analysis((select id from request_ids), 'casa-t2', pg_temp.enc('BB')) $$, 'P0002', null,
  'pedido já resolvido NÃO resolve de novo');

reset role;
select throws_ok($$ update public.house_analysis_requests set answers_enc = pg_temp.enc('x') $$, '23514', null,
  'a tabela NÃO aceita respostas em pedido resolvido');
select throws_ok($$ insert into public.house_analysis_requests (profile_id, term_version, tied_axes, answers_enc)
                     values (pg_temp.person('p1'), 'termo-1', array['house1'], pg_temp.enc('x')),
                            (pg_temp.person('p1'), 'termo-1', array['house1'], pg_temp.enc('x')) $$, '23505', null,
  'a tabela NÃO aceita dois pedidos abertos da mesma pessoa');
set local role authenticated;

-- ---------------------------------------------------------------------------------------
-- As respostas somem quando o pedido deixa de fazer sentido
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p2');
select lives_ok($$ select pg_temp.analyze('termo-1', array['house2'], 'respA') $$, 'p2 abre um pedido');
select lives_ok($$ select public.accept_house('casa-t1', 'self', null) $$, 'p2 escolhe e aceita uma casa direto');
select results_eq($$ select status, resolution, answers_enc is null, resolved_by is null from public.house_analysis_requests $$,
  $$ values ('resolved'::text, 'self'::text, true, true) $$,
  'aceitar uma casa fecha o pedido e apaga as respostas');

select pg_temp.login('p3');
select lives_ok($$ select pg_temp.analyze('termo-1', array['totem1'], 'respB') $$, 'p3 abre um pedido');
select lives_ok($$ select pg_temp.record('termo-1', 'casa-t1', 'AA') $$,
  'p3 refaz e agora o resultado é conclusivo');
select results_eq($$ select status, resolution, answers_enc is null from public.house_analysis_requests $$,
  $$ values ('resolved'::text, 'self'::text, true) $$,
  'um resultado conclusivo fecha o pedido e apaga as respostas');


-- ---------------------------------------------------------------------------------------
-- O navegador não impõe resultado: só o servidor assina (ADR 0014)
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p2');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t2', pg_temp.enc('AA'), pg_temp.now_s(), 'assinatura-qualquer') $$, '42501', null,
  'resultado sem assinatura válida é recusado (chamada direta pela API)');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t2', pg_temp.enc('AA'), pg_temp.now_s(), null) $$, '42501', null,
  'resultado sem assinatura nenhuma é recusado');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t2', pg_temp.enc('AA'), pg_temp.now_s(),
    pg_temp.sig(format('result|%s|termo-1|casa-t2|%s|%s', pg_temp.person('p2'), pg_temp.enc('AA'), pg_temp.now_s()), 'outra-chave')) $$, '42501', null,
  'assinatura com outra chave é recusada');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t2', pg_temp.enc('AA'), pg_temp.now_s(),
    pg_temp.sig(format('result|%s|termo-1|casa-t2|%s|%s', pg_temp.person('p2'), pg_temp.enc('AB'), pg_temp.now_s()))) $$, '42501', null,
  'assinatura de outro totem NÃO vale para este (campo adulterado)');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t2', pg_temp.enc('AA'), pg_temp.now_s(),
    pg_temp.sig(format('result|%s|termo-1|casa-t2|%s|%s', pg_temp.person('p3'), pg_temp.enc('AA'), pg_temp.now_s()))) $$, '42501', null,
  'resultado assinado para OUTRA pessoa NÃO vale na sessão desta');
select throws_ok($$ select pg_temp.record('termo-1', 'casa-t2', 'AA', 600) $$, '42501', null,
  'assinatura emitida há mais de 5 minutos é recusada');
select throws_ok($$ select public.request_house_analysis('termo-1', array['house1'], pg_temp.enc('respA'), pg_temp.now_s(), 'x') $$, '42501', null,
  'pedido de análise sem assinatura do servidor é recusado');
select throws_ok($$ select public.request_house_analysis('termo-1', array['house1'], pg_temp.enc('respB'), pg_temp.now_s(),
    pg_temp.sig(format('analysis|%s|termo-1|house1|%s|%s', pg_temp.person('p2'), pg_temp.enc('respA'), pg_temp.now_s()))) $$, '42501', null,
  'a assinatura cobre o valor cifrado das respostas (trocar o conteúdo invalida)');
select throws_ok($$ select public.request_house_analysis('termo-1', array['house2'], pg_temp.enc('respA'), pg_temp.now_s(),
    pg_temp.sig(format('analysis|%s|termo-1|house1|%s|%s', pg_temp.person('p2'), pg_temp.enc('respA'), pg_temp.now_s()))) $$, '42501', null,
  'a assinatura cobre também os eixos empatados');
select lives_ok($$ select public.request_house_analysis('termo-1', array['house1'], pg_temp.enc('respA'), pg_temp.now_s(),
    pg_temp.sig(format('analysis|%s|termo-1|house1|%s|%s', pg_temp.person('p2'), pg_temp.enc('respA'), pg_temp.now_s()))) $$,
  'com a assinatura certa sobre o valor cifrado, o pedido é aceito');
reset role;
delete from public.house_analysis_requests where profile_id = pg_temp.person('p2') and status = 'open';
set local role authenticated;
select pg_temp.login('p2');
select throws_ok($$ select public.request_house_analysis('termo-1', null, null, pg_temp.now_s(), 'x') $$, '42501', null,
  'pedido vazio e sem assinatura é recusado');
reset role;
update app.server_secrets set value = '' where name = 'questionnaire_signing_key';
set local role authenticated;
select pg_temp.login('p2');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t2', pg_temp.enc('AA'), pg_temp.now_s(),
    pg_temp.sig(format('result|%s|termo-1|casa-t2|%s|%s', pg_temp.person('p2'), pg_temp.enc('AA'), pg_temp.now_s()), '')) $$, '42501', null,
  'chave vazia no banco: falha fechado, mesmo com assinatura feita com a chave vazia');
reset role;
update app.server_secrets set value = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' where name = 'questionnaire_signing_key';
set local role authenticated;
select pg_temp.login('p2');
select throws_ok($$ select public.record_questionnaire_result('termo-1', 'casa-t2', pg_temp.enc('AA'), pg_temp.now_s(),
    pg_temp.sig(format('result|%s|termo-1|casa-t2|%s|%s', pg_temp.person('p2'), pg_temp.enc('AA'), pg_temp.now_s()), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) $$, '42501', null,
  'chave com menos de 32 caracteres: falha fechado');
reset role;
delete from app.server_secrets where name = 'questionnaire_signing_key';
set local role authenticated;
select pg_temp.login('p2');
select throws_ok($$ select pg_temp.record('termo-1', 'casa-t2', 'AA') $$, '42501', null, 'sem chave instalada: falha fechado');
reset role;
insert into app.server_secrets (name, value) values ('questionnaire_signing_key', 'chave-de-teste-do-servidor-com-32-ou-mais');
set local role authenticated;
select pg_temp.login('p2');
select throws_ok($$ select * from app.server_secrets $$, '42501', null, 'a chave de assinatura NÃO é lida pela API');

-- ---------------------------------------------------------------------------------------
-- Eventos da fila só para a coordenação nacional; resolução e prazo
-- ---------------------------------------------------------------------------------------
reset role;
insert into public.audit_log (actor_id, event, target_id) values (pg_temp.person('p1'), 'house_analysis_requested', pg_temp.person('p1'));
set local role authenticated;
select pg_temp.login('sp_mgr');
select is((select count(*)::int from public.audit_log where event in ('house_analysis_requested', 'house_analysis_resolved')), 0,
  'gestor de estado, que gerencia a pessoa, NÃO lê os eventos da fila');
select pg_temp.login('hc_root');
select is((select count(*)::int from public.audit_log where event in ('house_analysis_requested', 'house_analysis_resolved')), 0,
  'coordenador nacional de casa NÃO lê os eventos da fila');
select pg_temp.login('root_mgr');
select ok((select count(*)::int from public.audit_log where event in ('house_analysis_requested', 'house_analysis_resolved')) >= 2,
  'a coordenação nacional lê os eventos da fila');

-- A coordenação nacional não resolve o próprio pedido.
reset role;
insert into public.questionnaire_consents (profile_id, term_version) values (pg_temp.person('root_mgr'), 'termo-1');
set local role authenticated;
select pg_temp.login('root_mgr');
select lives_ok($$ select pg_temp.analyze('termo-1', array['house1'], 'respA') $$, 'o gestor da raiz abre um pedido para si');
create temp table own_request (id uuid);
reset role;
insert into own_request select pg_temp.open_request_of('root_mgr');
grant select on own_request to authenticated;
set local role authenticated;
select pg_temp.login('root_mgr');
select throws_ok($$ select public.resolve_house_analysis((select id from own_request), 'casa-t1', pg_temp.enc('AB')) $$, '42501', null,
  'a coordenação NÃO resolve o próprio pedido');

-- Só resolve pedido de quem está ativo.
select pg_temp.login('p3');
select lives_ok($$ select pg_temp.analyze('termo-1', array['totem2'], 'respA') $$, 'p3 abre outro pedido');
create temp table p3_request (id uuid);
reset role;
insert into p3_request select pg_temp.open_request_of('p3');
grant select on p3_request to authenticated;
update public.profiles set status = 'suspended' where id = pg_temp.person('p3');
select is((select resolution from public.house_analysis_requests where id = (select id from p3_request)),
  'inactive', 'suspender a pessoa fecha o pedido');
select is((select count(*)::int from public.house_analysis_requests where profile_id = pg_temp.person('p3') and answers_enc is not null), 0,
  '... e apaga as respostas');
update public.profiles set status = 'active' where id = pg_temp.person('p3');
insert into public.house_analysis_requests (profile_id, term_version, tied_axes, answers_enc) values (pg_temp.person('p3'), 'termo-1', array['house1'], pg_temp.enc('respA'));
update public.profiles set access_status = 'blocked' where id = pg_temp.person('p3');
select is((select count(*)::int from public.house_analysis_requests where profile_id = pg_temp.person('p3') and status = 'open'), 0,
  'bloquear a pessoa também fecha o pedido aberto');
update public.profiles set access_status = 'active' where id = pg_temp.person('p3');
set local role authenticated;
select pg_temp.login('root_mgr');
select throws_ok($$ select public.resolve_house_analysis((select id from p3_request), 'casa-t1', pg_temp.enc('AB')) $$, 'P0002', null,
  'pedido já fechado (pessoa suspensa) não é resolvido');

-- Prazo: depois de 30 dias as respostas não são lidas e são apagadas na próxima chamada.
select pg_temp.login('p2');
select lives_ok($$ select pg_temp.analyze('termo-1', array['house2'], 'respB') $$, 'p2 abre um pedido (antes do prazo)');
reset role;
update public.house_analysis_requests set created_at = now() - interval '31 days' where profile_id = pg_temp.person('p2') and status = 'open';
set local role authenticated;
select pg_temp.login('p2');
select is((select count(*)::int from public.house_analysis_requests where status = 'open'), 0, 'pedido vencido não aparece como aberto para a pessoa');
select pg_temp.login('root_mgr');
select is((select count(*)::int from public.house_analysis_requests where profile_id = pg_temp.person('p2') and status = 'open'), 0,
  'nem para a coordenação nacional');
select pg_temp.login('p3');
select lives_ok($$ select pg_temp.record('termo-1', 'casa-t1', 'AA') $$, 'qualquer chamada das funções apaga as respostas vencidas');
reset role;
select results_eq($$ select status, resolution, answers_enc is null from public.house_analysis_requests where profile_id = pg_temp.person('p2') and resolution = 'expired' $$,
  $$ values ('resolved'::text, 'expired'::text, true) $$, 'o pedido vencido foi fechado como expirado, sem respostas');
set local role authenticated;
-- ---------------------------------------------------------------------------------------
-- Exportação (LGPD art. 18): o totem e os pedidos vão para a própria pessoa
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p1');
select lives_ok($$ select pg_temp.analyze('termo-1', array['house1'], 'respA') $$, 'p1 abre outro pedido');
select is((public.export_own_data() -> 'questionnaire_result' ->> 'totem_enc'), null,
  'o pedido novo apagou o resultado anterior, e o export reflete isso');
select is(jsonb_array_length(public.export_own_data() -> 'house_analysis_requests'), 2,
  'o export traz os pedidos (resolvido e aberto)');
select is((select r ->> 'answers_enc' from jsonb_array_elements(public.export_own_data() -> 'house_analysis_requests') as r
           where r ->> 'status' = 'open'), pg_temp.enc('respA'),
  'o export traz as respostas (cifradas) do pedido aberto');
select is((select r -> 'answers_enc' from jsonb_array_elements(public.export_own_data() -> 'house_analysis_requests') as r
           where r ->> 'status' = 'resolved'), 'null'::jsonb,
  'o export NÃO traz respostas do pedido resolvido');
select pg_temp.login('p3');
select is((public.export_own_data() -> 'questionnaire_result' ->> 'totem_enc'), pg_temp.enc('AA'), 'o export traz o totem (cifrado) da própria pessoa');

-- Totem e respostas só existem cifrados: nenhuma coluna em texto puro (ADR 0003).
select columns_are('public', 'questionnaire_results',
  array['profile_id', 'term_version', 'house_key', 'totem_enc', 'source', 'created_at'],
  'questionnaire_results guarda o totem só cifrado (totem_enc), sem coluna em texto puro');
select columns_are('public', 'house_analysis_requests',
  array['id', 'profile_id', 'term_version', 'tied_axes', 'answers_enc', 'status', 'resolution', 'created_at', 'resolved_at', 'resolved_by'],
  'house_analysis_requests guarda as respostas só cifradas (answers_enc), sem coluna em texto puro');

-- ---------------------------------------------------------------------------------------
-- Delegação (decisão do gestor): a nacional concede a um gestor de unidade abaixo da raiz o
-- acesso ao totem, aos pedidos e aos eventos da fila das pessoas ativas do escopo dele
-- ---------------------------------------------------------------------------------------
reset role;
insert into public.questionnaire_consents (profile_id, term_version) values (pg_temp.person('abc_mgr'), 'termo-1');
-- Escopos: p1 só no estado SP; p3 na equipe 1 da incubadora ABC; p2 em Minas Gerais (fora de SP).
create function pg_temp.place(p_name text, p_path text) returns void language sql as $$
  update public.unit_members set left_at = now() where profile_id = pg_temp.person(p_name) and left_at is null;
  insert into public.unit_members (unit_id, profile_id)
  select id, pg_temp.person(p_name) from public.units where path::text = p_path;
$$;
select pg_temp.place('p2', 'br.mg');
select pg_temp.place('p3', 'br.sp.abc.equipe_1');
insert into public.role_assignments (profile_id, role, unit_id)
select pg_temp.person('abc_mgr'), 'manager', id from public.units where path::text = 'br.sp.abc';
create temp table unit_ids2 (slug text primary key, id uuid not null);
insert into unit_ids2 select path::text, id from public.units where path::text in ('br', 'br.sp', 'br.sp.abc', 'br.mg');
grant select on unit_ids2 to authenticated;
create function pg_temp.unit2(p_path text) returns uuid language sql stable as $$ select id from unit_ids2 where slug = p_path $$;

-- Fixtures diretas (como se o servidor tivesse gravado): resultado de p1, p2 e p3; pedido aberto de p1 e p2.
delete from public.questionnaire_results;
delete from public.house_analysis_requests;
update public.profiles set status = 'active', access_status = 'active' where id in (select id from people where name <> 'wait');
insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source) values
  (pg_temp.person('p1'), 'termo-1', 'casa-t1', pg_temp.enc('T1'), 'questionnaire'),
  (pg_temp.person('p2'), 'termo-1', 'casa-t1', pg_temp.enc('T2'), 'questionnaire'),
  (pg_temp.person('p3'), 'termo-1', 'casa-t1', pg_temp.enc('T3'), 'questionnaire');
insert into public.house_analysis_requests (profile_id, term_version, tied_axes, answers_enc) values
  (pg_temp.person('p1'), 'termo-1', array['house1'], pg_temp.enc('R1')),
  (pg_temp.person('p2'), 'termo-1', array['house1'], pg_temp.enc('R2'));
insert into public.audit_log (actor_id, event, target_id) values
  (pg_temp.person('p1'), 'house_analysis_requested', pg_temp.person('p1')),
  (pg_temp.person('p2'), 'house_analysis_requested', pg_temp.person('p2'));
grant select on public.questionnaire_data_grants to authenticated;
set local role authenticated;

-- Sem concessão, só a nacional lê.
select pg_temp.login('sp_mgr');
select is(pg_temp.results_seen(), 0, 'sem concessão, o gestor de estado NÃO lê totem');
select is(pg_temp.requests_seen(), 0, '... nem pedidos de análise');
select is((select count(*)::int from public.audit_log where event = 'house_analysis_requested'), 0, '... nem os eventos da fila');
select pg_temp.login('abc_mgr');
select is(pg_temp.results_seen(), 0, 'sem concessão, o gestor da incubadora NÃO lê totem');
select pg_temp.login('root_mgr');
select is(pg_temp.results_seen(), 3, 'a coordenação nacional segue lendo tudo');

-- Quem concede: só o gestor ativo da raiz, e nunca a si mesmo.
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('abc_mgr'), pg_temp.unit2('br.sp.abc')) $$, '42501', null,
  'gestor de estado NÃO concede acesso');
select pg_temp.login('hc_root');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('sp_mgr'), pg_temp.unit2('br.sp')) $$, '42501', null,
  'coordenador nacional de casa NÃO concede acesso');
select pg_temp.login('p1');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('p1'), pg_temp.unit2('br.sp')) $$, '42501', null,
  'pessoa comum NÃO concede acesso, nem a si mesma');
select pg_temp.login('root_mgr');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('root_mgr'), pg_temp.unit2('br')) $$, '42501', null,
  'a coordenação nacional NÃO concede a si mesma');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('p1'), pg_temp.unit2('br.sp')) $$, '22023', null,
  'quem não é gestor da unidade é recusado');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('sp_mgr'), pg_temp.unit2('br.sp.abc')) $$, '22023', null,
  'o papel de gestor precisa ser da unidade concedida (não de outra)');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('root_mgr'), pg_temp.unit2('br')) $$, '42501', null,
  'a raiz não é delegável (a nacional já lê)');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('wait'), pg_temp.unit2('br.sp')) $$, '22023', null,
  'quem não está ativo não recebe concessão');
select lives_ok($$ select public.grant_questionnaire_access(pg_temp.person('sp_mgr'), pg_temp.unit2('br.sp')) $$,
  'a coordenação nacional concede ao gestor de SP');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('sp_mgr'), pg_temp.unit2('br.sp')) $$, '23505', null,
  'a mesma concessão ativa não se repete');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_access_granted'), 1,
  'a concessão é auditada (a nacional lê o evento)');
select throws_ok($$ insert into public.questionnaire_data_grants (grantee_id, unit_id) values (pg_temp.person('abc_mgr'), pg_temp.unit2('br.sp.abc')) $$, '42501', null,
  'NÃO grava concessão direto na tabela');

-- Com concessão: só o escopo dele (SP: p1 e p3; p2 está em Minas).
select pg_temp.login('sp_mgr');
select results_eq($$ select profile_id from public.questionnaire_results order by profile_id $$,
  $$ values (pg_temp.person('p1')), (pg_temp.person('p3')) $$,
  'com concessão, vê o totem só das pessoas do escopo dele');
select is((select totem_enc from public.questionnaire_results where profile_id = pg_temp.person('p1')), pg_temp.enc('T1'), '... (cifrado, para o servidor decifrar)');
select is(pg_temp.requests_seen(), 1, 'vê o pedido de análise só do escopo dele (p1; o de p2 é de fora)');
select is((select count(*)::int from public.audit_log where event = 'house_analysis_requested' and target_id = pg_temp.person('p2')), 0,
  'NÃO lê o evento da fila de quem é de fora do escopo');
select ok((select count(*)::int from public.audit_log where event = 'house_analysis_requested' and target_id = pg_temp.person('p1')) >= 1,
  'lê o evento da fila de quem é do escopo');
select is((select count(*)::int from public.audit_log where event in ('questionnaire_access_granted', 'questionnaire_access_revoked')), 0,
  'NÃO lê os eventos da própria delegação (só a nacional)');
select throws_ok($$ select public.resolve_house_analysis((select id from public.house_analysis_requests limit 1), 'casa-t1', pg_temp.enc('AB')) $$, '42501', null,
  'a delegação NÃO inclui resolver a fila [?]');
select throws_ok($$ select public.grant_questionnaire_access(pg_temp.person('abc_mgr'), pg_temp.unit2('br.sp.abc')) $$, '42501', null,
  'quem recebeu NÃO repassa a concessão');
select is((select count(*)::int from public.questionnaire_data_grants), 1, 'o gestor lê a própria concessão');
select pg_temp.login('abc_mgr');
select is(pg_temp.results_seen(), 0, 'a concessão de SP NÃO vale para o gestor da incubadora');
select is((select count(*)::int from public.questionnaire_data_grants), 0, 'ele NÃO lê a concessão dos outros');
select pg_temp.login('p1');
select is(pg_temp.results_seen(), 1, 'a pessoa segue lendo só o próprio resultado');
select is((select count(*)::int from public.questionnaire_data_grants), 0, 'pessoa comum NÃO lê concessões');

-- Escopo mais estreito: concessão só da incubadora ABC.
select pg_temp.login('root_mgr');
select lives_ok($$ select public.grant_questionnaire_access(pg_temp.person('abc_mgr'), pg_temp.unit2('br.sp.abc')) $$,
  'a nacional concede ao gestor da incubadora ABC');
select pg_temp.login('abc_mgr');
select results_eq($$ select profile_id from public.questionnaire_results $$, $$ values (pg_temp.person('p3')) $$,
  'o gestor da incubadora vê só quem está abaixo da incubadora (p3; p1 só no estado)');
select is(pg_temp.requests_seen(), 0, '... e nenhum pedido (p3 não tem pedido aberto)');

-- Só pessoas ativas: suspender p1 tira p1 do alcance.
reset role;
update public.profiles set status = 'suspended' where id = pg_temp.person('p1');
set local role authenticated;
select pg_temp.login('sp_mgr');
select results_eq($$ select profile_id from public.questionnaire_results $$, $$ values (pg_temp.person('p3')) $$,
  'pessoa suspensa NÃO é lida pela delegação');
select is(pg_temp.requests_seen(), 0, '... e o pedido dela já foi fechado, sem respostas');
reset role;
update public.profiles set status = 'active' where id = pg_temp.person('p1');
set local role authenticated;

-- A concessão só vale enquanto o gestor mantém o papel na unidade.
reset role;
update public.role_assignments set revoked_at = now() where profile_id = pg_temp.person('sp_mgr') and role = 'manager';
set local role authenticated;
select pg_temp.login('sp_mgr');
select is(pg_temp.results_seen(), 0, 'sem o papel de gestor na unidade, a concessão deixa de valer');
reset role;
update public.role_assignments set revoked_at = null where profile_id = pg_temp.person('sp_mgr') and role = 'manager';
set local role authenticated;
select pg_temp.login('sp_mgr');
select is(pg_temp.results_seen(), 2, 'recuperado o papel, a concessão ativa volta a valer');

-- Revogar: só a nacional; depois, 0 linhas.
create temp table grant_ids (who text primary key, id uuid not null);
reset role;
insert into grant_ids select p.name, g.id from public.questionnaire_data_grants g join people p on p.id = g.grantee_id;
grant select on grant_ids to authenticated;
set local role authenticated;
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.revoke_questionnaire_access((select id from grant_ids where who = 'sp_mgr')) $$, '42501', null,
  'o próprio gestor NÃO revoga (nem estende) a concessão');
select pg_temp.login('root_mgr');
select lives_ok($$ select public.revoke_questionnaire_access((select id from grant_ids where who = 'sp_mgr')) $$,
  'a nacional revoga a concessão de SP');
select throws_ok($$ select public.revoke_questionnaire_access((select id from grant_ids where who = 'sp_mgr')) $$, 'P0002', null,
  'revogar de novo é recusado');
select is((select count(*)::int from public.audit_log where event = 'questionnaire_access_revoked'), 1, 'a revogação é auditada');
select pg_temp.login('sp_mgr');
select is(pg_temp.results_seen(), 0, 'revogada: 0 totens');
select is(pg_temp.requests_seen(), 0, '... 0 pedidos');
select is((select count(*)::int from public.audit_log where event in ('house_analysis_requested', 'house_analysis_resolved')), 0, '... 0 eventos da fila');
select is((select count(*)::int from public.questionnaire_data_grants where revoked_at is not null), 1,
  'o gestor ainda vê a própria concessão, agora revogada');
select is(jsonb_array_length(public.export_own_data() -> 'questionnaire_access_grants'), 1,
  'o export de quem recebeu traz a concessão (e a revogação)');
select pg_temp.login('abc_mgr');
select is(pg_temp.results_seen(), 1, 'a concessão da incubadora segue valendo (outra, não revogada)');

select * from finish();
rollback;
