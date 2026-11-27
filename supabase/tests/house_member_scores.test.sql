-- Notas dos membros de uma casa para o PERFIL MÉDIO (ADR 0014): `house_member_scores_enc` devolve, só ao servidor do app
-- (assinatura HMAC curta, ligada a quem chama e à casa), as notas CIFRADAS dos membros com casa aceita e resultado. O
-- servidor decifra, tira a média e descarta tudo; nada em claro no banco. Pessoas fictícias, só nesta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

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
create function pg_temp.sig(p_message text, p_key text default null) returns text language sql stable as $$
  select encode(extensions.hmac(convert_to(p_message, 'utf8'), convert_to(coalesce(p_key, (select k from signing_key)), 'utf8'), 'sha256'), 'hex')
$$;
create function pg_temp.now_s() returns bigint language sql stable as $$ select extract(epoch from now())::bigint $$;
-- Como a server action: assina para a pessoa da sessão e a casa pedida.
create function pg_temp.scores(p_house text, p_age_s bigint default 0, p_for text default null, p_house_signed text default null)
returns table (profile_id uuid, scores_enc text) language sql as $$
  select * from public.house_member_scores_enc(p_house, pg_temp.now_s() - p_age_s,
    pg_temp.sig(format('house_scores|%s|%s|%s', coalesce(p_for, (select auth.uid())::text), coalesce(p_house_signed, p_house), pg_temp.now_s() - p_age_s)))
$$;

-- v1, v2: membros da casa-t1 com resultado; v3: casa-t1 mas vínculo encerrado; v4: casa-t1 sem aceite; v5: casa-t1 sem notas
-- (resultado antigo); v6: casa-t2; w: na espera; me: quem pergunta (ativa, ainda sem casa, só de entrada).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000b4'), ('00000000-0000-0000-0000-0000000000b5'), ('00000000-0000-0000-0000-0000000000b6'),
  ('00000000-0000-0000-0000-0000000000b7'), ('00000000-0000-0000-0000-0000000000b8');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version, status, access_status)
select id, pg_temp.enc('n'), 3550308, 'v1', 'active', 'active' from auth.users where id::text like '00000000-0000-0000-0000-0000000000b%';
update public.profiles set access_status = 'waitlisted' where id = '00000000-0000-0000-0000-0000000000b7';
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles;
insert into app.questionnaire_term_versions (version) values ('termo-1') on conflict do nothing;
insert into public.houses (key, active) values ('casa-t1', true), ('casa-t2', true), ('casa-off', false) on conflict (key) do update set active = excluded.active;
insert into public.house_members (profile_id, house_key, join_method, accepted_at, left_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'casa-t1', 'self', now(), null),
  ('00000000-0000-0000-0000-0000000000b2', 'casa-t1', 'self', now(), null),
  ('00000000-0000-0000-0000-0000000000b3', 'casa-t1', 'self', now(), now()),
  ('00000000-0000-0000-0000-0000000000b4', 'casa-t1', 'self', null, null),
  ('00000000-0000-0000-0000-0000000000b5', 'casa-t1', 'self', now(), null),
  ('00000000-0000-0000-0000-0000000000b6', 'casa-t2', 'self', now(), null);
insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, scores_enc, source)
select id, 'termo-1', 'casa-t1', pg_temp.enc('totem' || right(id::text, 1)), case when right(id::text, 1) = 'b5' then null else pg_temp.enc('scores' || right(id::text, 1)) end, 'questionnaire'
from auth.users where right(id::text, 1) in ('1', '2', '3', '4', '5', '6');
update public.questionnaire_results set scores_enc = null where profile_id = '00000000-0000-0000-0000-0000000000b5';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b8');

select results_eq($$ select profile_id::text from pg_temp.scores('casa-t1') order by 1 $$,
  $$ values ('00000000-0000-0000-0000-0000000000b1'::text), ('00000000-0000-0000-0000-0000000000b2'::text) $$,
  'devolve só os membros com vínculo aberto e aceito da casa e notas (não o encerrado, o sem aceite, o sem notas nem outra casa)');
select results_eq($$ select scores_enc from pg_temp.scores('casa-t1') order by profile_id $$,
  $$ values (pg_temp.enc('scores1')), (pg_temp.enc('scores2')) $$,
  '... e as notas só cifradas (o banco não decifra)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'house_member_scores_enc' and pg_get_function_result(p.oid) = 'TABLE(profile_id uuid, scores_enc text)'), 1,
  'a função devolve só (profile_id, scores_enc): sem totem, sem nome, sem contato');
select is((select count(*)::int from pg_temp.scores('casa-t2')), 1, 'casa-t2 devolve o seu membro');

-- Recusas: sem assinatura, assinatura de outra casa, de outra pessoa, vencida, outra chave.
select throws_ok($$ select * from public.house_member_scores_enc('casa-t1', pg_temp.now_s(), 'x') $$, '42501', null, 'assinatura inválida é recusada');
select throws_ok($$ select * from public.house_member_scores_enc('casa-t1', pg_temp.now_s(), null) $$, '42501', null, 'sem assinatura é recusado');
select throws_ok($$ select * from pg_temp.scores('casa-t1', 0, null, 'casa-t2') $$, '42501', null, 'assinada para OUTRA casa não vale');
select throws_ok($$ select * from pg_temp.scores('casa-t1', 0, '00000000-0000-0000-0000-0000000000b1') $$, '42501', null, 'assinada para OUTRA pessoa não vale');
select throws_ok($$ select * from pg_temp.scores('casa-t1', 600) $$, '42501', null, 'assinatura de mais de 5 minutos é recusada');
select throws_ok($$ select * from public.house_member_scores_enc('casa-t1', pg_temp.now_s(),
    pg_temp.sig(format('house_scores|%s|casa-t1|%s', (select auth.uid()), pg_temp.now_s()), 'outra-chave-qualquer-com-32-ou-mais-xx')) $$, '42501', null, 'assinatura de outra chave é recusada');
select throws_ok($$ select * from pg_temp.scores('casa-off') $$, 'P0002', null, 'casa inativa é recusada');

-- Quem não é de entrada (na espera) não usa; anon nem executa.
select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select throws_ok($$ select * from pg_temp.scores('casa-t1') $$, '42501', null, 'na espera: recusado, mesmo com assinatura válida');
reset role;
select is(has_function_privilege('anon', 'public.house_member_scores_enc(text, bigint, text)', 'execute'), false, 'anon não executa');
select is(has_function_privilege('authenticated', 'public.house_member_scores_enc(text, bigint, text)', 'execute'), true, 'authenticated executa (só vale com a assinatura do servidor)');

select * from finish();
rollback;
