-- "Baixar meus dados" (issue #20): `public.export_own_data()` devolve só os dados de quem
-- chama, sem HMAC nem id de terceiros, registra `data_exported` e limita a 5 por hora.
-- Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.export() returns jsonb language sql as $$
  select public.export_own_data()
$$;

-- a: titular (SP, entra na unidade do estado pelo trigger); b: outra pessoa, mesmo estado;
-- c: sem perfil ainda.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');
insert into public.profiles (id, display_name_enc, municipality_code, district_code, neighborhood_enc, consent_version) values
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.enc('NomeA'), 3550308, 355030878, pg_temp.enc('BairroA'), 'v1'),
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.enc('NomeB'), 3550308, null, null, 'v1');
update public.profiles set access_status = 'active', status = 'active'
where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac) values
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.enc('ZapA'), repeat('a', 64)),
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.enc('ZapB'), repeat('b', 64));
-- Formação e atividade (#304): só A tem.
insert into public.profile_background (profile_id, education_level_enc, education_detail_enc, occupation_enc)
values ('00000000-0000-0000-0000-0000000000a1', pg_temp.enc('NivelA'), pg_temp.enc('QualA'), pg_temp.enc('AtividadeA'));

-- O vínculo de A com o estado foi encerrado: a RLS já não mostra a unidade a A, mas o
-- histórico é dado dela e entra na exportação.
update public.unit_members set left_at = now()
where profile_id = '00000000-0000-0000-0000-0000000000a1';

-- A aceitou o termo vigente; B não.
insert into public.consent_acceptances (user_id, version)
values ('00000000-0000-0000-0000-0000000000a1', 'v1');

-- A concedeu um papel a B: é dado de B (A só vê pela RLS para poder revogar).
insert into public.role_assignments (profile_id, role, unit_id, granted_by)
select '00000000-0000-0000-0000-0000000000a2', 'monitor', u.id, '00000000-0000-0000-0000-0000000000a1'
from public.units as u where u.state_code = 'SP';
-- Papel de A em outro estado, concedido por B.
insert into public.role_assignments (profile_id, role, unit_id, granted_by)
select '00000000-0000-0000-0000-0000000000a1', 'spokesperson', u.id, '00000000-0000-0000-0000-0000000000a2'
from public.units as u where u.state_code = 'MG';
-- Auditoria: um evento sobre A (por B) e um sobre B (por A).
insert into public.audit_log (actor_id, event, target_id, reason) values
  ('00000000-0000-0000-0000-0000000000a2', 'access_granted', '00000000-0000-0000-0000-0000000000a1', 'manual'),
  ('00000000-0000-0000-0000-0000000000a1', 'access_blocked', '00000000-0000-0000-0000-0000000000a2', 'manual');

-- ---------------------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------------------
select is(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_proc where oid = 'public.export_own_data()'::regprocedure),
  true,
  'export_own_data é security definer com search_path vazio'
);
select ok(
  not has_function_privilege('anon', 'public.export_own_data()', 'execute'),
  'anon não executa export_own_data'
);

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.export_own_data() $$, '42501', null,
  'visitante anônimo NÃO exporta');

-- Casa e termo do questionário (#132): A aceita o termo e a casa pelo questionário; B escolhe
-- outra casa direto. Os eventos de B não podem ir para o arquivo de A.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select public.accept_house('atenas', 'self', null);
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.record_questionnaire_consent('termo-exemplo-1');
select public.accept_house('esparta', 'questionnaire', 'termo-exemplo-1');

-- ---------------------------------------------------------------------------------------
-- A exporta
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temporary table out_a as select pg_temp.export() as d;

select is((select d->'profile'->>'display_name_enc' from out_a), pg_temp.enc('NomeA'),
  'nome (ainda cifrado) de A');
select is((select d->'profile'->>'neighborhood_enc' from out_a), pg_temp.enc('BairroA'),
  'bairro (ainda cifrado) de A');
select is(
  (select (d->'profile'->>'municipality_name') || '/' || (d->'profile'->>'state_code') || '/'
          || (d->'profile'->>'district_code') || '/' || (d->'profile'->>'district_name') || '/' || (d->'profile'->>'consent_version')
          || '/' || (d->'profile'->>'access_status') from out_a),
  'São Paulo/SP/355030878/Sé/v1/active',
  'município, UF, distrito (código e nome), versão do termo e liberação de A'
);
select ok((select d->'profile' ? 'consent_at' and d->'profile' ? 'created_at' from out_a),
  'data do termo e do cadastro presentes');
select is((select d->'contact'->>'whatsapp_enc' from out_a), pg_temp.enc('ZapA'),
  'WhatsApp (ainda cifrado) de A');
select is(
  (select d->'background'->>'education_level_enc' || '/' || (d->'background'->>'education_detail_enc') || '/'
          || (d->'background'->>'occupation_enc') from out_a),
  pg_temp.enc('NivelA') || '/' || pg_temp.enc('QualA') || '/' || pg_temp.enc('AtividadeA'),
  'formação e atividade (ainda cifradas) de A'
);
select ok(
  (select d::text not like '%hmac%' and d::text not like '%' || repeat('a', 64) || '%' from out_a),
  'nenhum HMAC na exportação'
);
select is(
  (select jsonb_agg(m->>'unit_name' || '/' || (m->>'left_at' is not null)::text)
   from out_a, jsonb_array_elements(d->'memberships') as m),
  '["São Paulo/true"]'::jsonb,
  'vínculo encerrado aparece, com o nome da unidade (que a RLS já não mostra a A)'
);
select is_empty(
  $$ select 1 from public.units where state_code = 'SP' $$,
  'pela RLS, A já não vê a unidade do vínculo encerrado'
);
select is(
  (select jsonb_agg(r->>'role') from out_a, jsonb_array_elements(d->'roles') as r),
  '["spokesperson"]'::jsonb,
  'só o papel de A, não o que A concedeu a B'
);
select ok(
  (select d::text not like '%granted_by%' and d::text not like '%actor%' from out_a),
  'sem id de quem concedeu o papel nem de quem fez a ação'
);
select is(
  (select jsonb_agg(e->>'event' || '/' || coalesce(e->>'reason', '-'))
   from out_a, jsonb_array_elements(d->'audit_events') as e),
  '["access_granted/manual", "questionnaire_consented/-", "house_accepted/questionnaire", "data_exported/-"]'::jsonb,
  'auditoria sobre A, os próprios eventos de casa e do termo (#132) e a própria exportação'
);
select is(
  (select jsonb_agg(jsonb_build_object('e', e->>'event', 't', e->'term_version', 'h', e->'house_key')
                    order by e->>'event')
   from out_a, jsonb_array_elements(d->'audit_events') as e
   where e->>'event' in ('house_accepted', 'questionnaire_consented')),
  '[{"e": "house_accepted", "t": "termo-exemplo-1", "h": "esparta"},
    {"e": "questionnaire_consented", "t": "termo-exemplo-1", "h": null}]'::jsonb,
  'os eventos de casa trazem a versão do termo e a casa (#132)'
);
select is(
  (select jsonb_agg(h - 'joined_at' - 'accepted_at') from out_a, jsonb_array_elements(d->'house_memberships') as h),
  '[{"house_key": "esparta", "join_method": "questionnaire", "consent_version": "termo-exemplo-1", "left_at": null}]'::jsonb,
  'o vínculo de casa de A vai no arquivo, com a forma e a versão do termo'
);
select ok(
  (select h->>'accepted_at' is not null and h->>'joined_at' is not null
   from out_a, jsonb_array_elements(d->'house_memberships') as h),
  'com as datas de entrada e de aceite'
);
select is(
  (select jsonb_agg(c->>'version') from out_a, jsonb_array_elements(d->'consent_acceptances') as c),
  '["v1"]'::jsonb,
  'o aceite do termo de consentimento de A vai no arquivo (versão)'
);
select ok(
  (select c->>'accepted_at' is not null from out_a, jsonb_array_elements(d->'consent_acceptances') as c),
  'com a data do aceite'
);
select is(
  (select jsonb_agg(q->>'term_version') from out_a, jsonb_array_elements(d->'questionnaire_consents') as q),
  '["termo-exemplo-1"]'::jsonb,
  'o aceite do termo do questionário de A vai no arquivo'
);
select ok(
  (select d::text not like '%atenas%' from out_a),
  'a casa de B não aparece no arquivo de A'
);
select ok(
  (select d::text not like '%' || pg_temp.enc('NomeB') || '%'
      and d::text not like '%' || pg_temp.enc('ZapB') || '%'
      and d::text not like '%00000000-0000-0000-0000-0000000000a2%' from out_a),
  'nada de B na exportação de A (nome, WhatsApp ou id)'
);
select is(
  (select count(*)::int from public.export_own_data() as d
   where d::text like '%00000000-0000-0000-0000-0000000000a1%'),
  0,
  'nem o próprio id vai no arquivo (só dados legíveis)'
);

-- ---------------------------------------------------------------------------------------
-- Limite: 5 por hora por pessoa (A já exportou 2 vezes)
-- ---------------------------------------------------------------------------------------
select lives_ok($$ select pg_temp.export() $$, '3ª exportação na hora passa');
select lives_ok($$ select pg_temp.export() $$, '4ª exportação na hora passa');
select lives_ok($$ select pg_temp.export() $$, '5ª exportação na hora passa');
select throws_ok($$ select pg_temp.export() $$, '54000', null,
  '6ª exportação na mesma hora é recusada');

-- B não é afetado pelo limite de A.
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(
  (select d->'contact'->>'whatsapp_enc' from pg_temp.export() as d),
  pg_temp.enc('ZapB'),
  'B exporta os próprios dados (o limite é por pessoa)'
);

-- Quem ainda não tem perfil recebe a estrutura vazia.
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(
  (select jsonb_build_array(d->'profile', d->'contact', d->'memberships', d->'roles',
                            d->'house_memberships', d->'questionnaire_consents')
   from pg_temp.export() as d),
  '[null, null, [], [], [], []]'::jsonb,
  'sem perfil: estrutura vazia, sem dados de ninguém'
);

reset role;
select is(
  (select count(*)::int from public.audit_log
   where event = 'data_exported' and actor_id = '00000000-0000-0000-0000-0000000000a1'
     and target_id = actor_id),
  5,
  'cada exportação de A gravou data_exported (a recusada não)'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event) values (null, 'nao_existe') $$,
  '23514', null,
  'evento fora da lista continua recusado'
);

select * from finish();
rollback;
