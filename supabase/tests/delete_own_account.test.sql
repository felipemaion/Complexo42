-- "Excluir minha conta" (issue #18): `public.delete_own_account()` apaga a conta de quem chama
-- e tudo o que é dela, exige login recente, não mexe em ninguém mais e grava `account_deleted`.
-- O audit_log continua só-inserção. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(55);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
-- JWT de uma sessão criada (= login) há `p_age` segundos: cria a linha em auth.sessions e
-- põe o `session_id` no JWT, como o GoTrue. `p_age` null: JWT sem `session_id`. Conta que não
-- existe mais: `session_id` de uma sessão que não existe. `security definer`: roda também com
-- o papel `authenticated` ativo.
create function pg_temp.login(p_id uuid, p_age integer default 30) returns uuid
language plpgsql security definer as $$
declare
  sid uuid;
begin
  if p_age is not null then
    sid := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at)
    select sid, p_id, now() - make_interval(secs => p_age)
    where exists (select 1 from auth.users where id = p_id);
  end if;
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_id, 'role', 'authenticated')
     || case when sid is null then '{}'::jsonb else jsonb_build_object('session_id', sid) end)::text, true);
  return sid;
end;
$$;
-- JWT com claims arbitrárias (para os casos de `session_id` estranho).
create function pg_temp.claims(p_claims jsonb) returns void language sql as $$
  select set_config('request.jwt.claims', p_claims::text, true);
$$;
-- Toda coluna uuid (public, app, auth) com uma linha que ainda cita `p_id`, fora as colunas
-- do audit_log, onde o id fica de propósito (sem FK). Pega também tabelas criadas no futuro.
create function pg_temp.leftovers(p_id uuid) returns setof text language plpgsql as $$
declare
  col record;
  n bigint;
begin
  for col in
    select c.table_schema, c.table_name, c.column_name
    from information_schema.columns as c
    join information_schema.tables as t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema in ('public', 'app', 'auth')
      and t.table_type = 'BASE TABLE'
      and c.data_type = 'uuid'
      and not (c.table_schema = 'public' and c.table_name = 'audit_log')
  loop
    execute format('select count(*) from %I.%I where %I = $1',
                   col.table_schema, col.table_name, col.column_name)
      into n using p_id;
    if n > 0 then
      return next col.table_schema || '.' || col.table_name || '.' || col.column_name;
    end if;
  end loop;
  -- Rastro do GoTrue (o id fica dentro do JSON).
  if exists (select 1 from auth.audit_log_entries as e where e.payload::text like '%' || p_id || '%') then
    return next 'auth.audit_log_entries.payload';
  end if;
end;
$$;
create function pg_temp.rows_of(p_id uuid) returns text language sql as $$
  select (select count(*) from public.profiles where id = p_id) || '/'
      || (select count(*) from public.profile_contacts where profile_id = p_id) || '/'
      || (select count(*) from public.unit_members where profile_id = p_id) || '/'
      || (select count(*) from public.role_assignments where profile_id = p_id)
$$;

-- a: vai excluir a conta (ativa, com tudo); b: outra pessoa, mesmo estado; c: exclui antes de a;
-- p: entrou mas ainda não tem perfil; w: está na espera.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@exemplo.org'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@exemplo.org'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@exemplo.org'),
  ('00000000-0000-0000-0000-0000000000a4', 'p@exemplo.org'),
  ('00000000-0000-0000-0000-0000000000a5', 'w@exemplo.org');
insert into auth.identities (provider_id, user_id, identity_data, provider) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1',
   '{"email": "a@exemplo.org"}', 'email');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000005a', '00000000-0000-0000-0000-0000000000a1');
insert into auth.audit_log_entries (id, payload) values
  (gen_random_uuid(), '{"action": "user_signedup", "actor_id": "00000000-0000-0000-0000-0000000000a1", "actor_username": "a@exemplo.org"}'),
  (gen_random_uuid(), '{"action": "user_invited", "actor_id": "", "traits": {"user_id": "00000000-0000-0000-0000-0000000000a1", "user_email": "a@exemplo.org"}}'),
  (gen_random_uuid(), '{"action": "user_signedup", "actor_id": "00000000-0000-0000-0000-0000000000a2", "actor_username": "b@exemplo.org"}'),
  -- Ligadas a A só pelo id (sem e-mail): saem.
  (gen_random_uuid(), '{"action": "token_refreshed", "actor_id": "00000000-0000-0000-0000-0000000000a1"}'),
  (gen_random_uuid(), '{"action": "user_modified", "traits": {"user_id": "00000000-0000-0000-0000-0000000000a1"}}'),
  -- Ligadas a A só pelo e-mail (sem id): saem. As de e-mail parecido, mas diferente, ficam.
  (gen_random_uuid(), '{"action": "user_recovery_requested", "actor_username": "a@exemplo.org"}'),
  (gen_random_uuid(), '{"action": "user_invited", "traits": {"user_email": "a@exemplo.org"}}'),
  (gen_random_uuid(), '{"action": "user_recovery_requested", "actor_username": "xa@exemplo.org"}'),
  (gen_random_uuid(), '{"action": "user_recovery_requested", "actor_username": "A@exemplo.org"}');
insert into auth.flow_state (id, user_id, auth_code, code_challenge_method, code_challenge, provider_type, provider_access_token, provider_refresh_token, authentication_method)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'x', 's256', 'x', 'google', '', '', 'oauth');

insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.enc('NomeA'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.enc('NomeB'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000a3', pg_temp.enc('NomeC'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000a5', pg_temp.enc('NomeW'), 3550308, 'v1');
update public.profiles set access_status = 'active', status = 'active'
where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             '00000000-0000-0000-0000-0000000000a3');
update public.profiles set access_status = 'waitlisted'
where id = '00000000-0000-0000-0000-0000000000a5';
insert into public.access_waitlist_hmac (profile_id, email_hmac) values
  ('00000000-0000-0000-0000-0000000000a5', repeat('e', 64));
insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac) values
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.enc('ZapA'), repeat('a', 64)),
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.enc('ZapB'), repeat('b', 64));
insert into app.profile_save_attempts (profile_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.profile_skills (profile_id, skill_id)
select p.id, (select id from public.skills order by name limit 1)
from public.profiles as p where p.id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
insert into public.consent_acceptances (user_id, version) values
  ('00000000-0000-0000-0000-0000000000a1', 'v1'),
  ('00000000-0000-0000-0000-0000000000a2', 'v1');
insert into public.questionnaire_consents (profile_id, term_version)
select '00000000-0000-0000-0000-0000000000a1', v.version
from app.questionnaire_term_versions as v limit 1;

-- A concedeu um papel a B; B concedeu um papel a A.
insert into public.role_assignments (profile_id, role, unit_id, granted_by)
select '00000000-0000-0000-0000-0000000000a2', 'monitor', u.id, '00000000-0000-0000-0000-0000000000a1'
from public.units as u where u.state_code = 'SP';
insert into public.role_assignments (profile_id, role, unit_id, granted_by)
select '00000000-0000-0000-0000-0000000000a1', 'spokesperson', u.id, '00000000-0000-0000-0000-0000000000a2'
from public.units as u where u.state_code = 'MG';
-- A encerrou o vínculo de B (`ended_by` = A, gravado pelo trigger com o JWT de A).
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update public.unit_members set left_at = now() where profile_id = '00000000-0000-0000-0000-0000000000a2';
-- A e B na casa (ADR 0011); A encerrou a casa de B (`ended_by` = A).
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'casa-exemplo-1', 'self', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'casa-exemplo-2', 'self', now());
update public.house_members set left_at = now() where profile_id = '00000000-0000-0000-0000-0000000000a2';
-- Auditoria antiga sobre A e sobre B.
insert into public.audit_log (actor_id, event, target_id, reason) values
  ('00000000-0000-0000-0000-0000000000a2', 'access_granted', '00000000-0000-0000-0000-0000000000a1', 'manual'),
  ('00000000-0000-0000-0000-0000000000a1', 'access_blocked', '00000000-0000-0000-0000-0000000000a2', 'manual');

-- ---------------------------------------------------------------------------------------
-- Estrutura e preparo
-- ---------------------------------------------------------------------------------------
select is(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_proc where oid = 'public.delete_own_account()'::regprocedure),
  true,
  'delete_own_account é security definer com search_path vazio'
);
select ok(not has_function_privilege('anon', 'public.delete_own_account()', 'execute'),
  'anon não executa delete_own_account');
select ok(has_function_privilege('authenticated', 'public.delete_own_account()', 'execute'),
  'authenticated executa delete_own_account');
select ok(not has_function_privilege('authenticated', 'app.auth_age_seconds()', 'execute'),
  'authenticated não chama app.auth_age_seconds direto');
select is(
  (select ended_by from public.unit_members where profile_id = '00000000-0000-0000-0000-0000000000a2'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'preparo: o vínculo de B foi encerrado por A'
);
select isnt_empty($$ select pg_temp.leftovers('00000000-0000-0000-0000-0000000000a1') $$,
  'preparo: o id de A aparece em várias tabelas');
select is(pg_temp.rows_of('00000000-0000-0000-0000-0000000000a1'), '1/1/1/1',
  'preparo: A tem perfil, contato, vínculo e papel');
select is((select count(*)::int from public.profile_skills where profile_id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'preparo: A tem uma habilidade marcada');
-- Regra para tabelas novas (docs/MODELO_DADOS.md): toda FK para a pessoa é `cascade` (dado
-- dela) ou `set null` (ela citada no dado de outra pessoa). `restrict`/`no action` impediria
-- a exclusão da conta.
select is_empty($$
  select c.conrelid::regclass::text || '.' || c.conname
  from pg_constraint as c
  join pg_namespace as n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
  where c.contype = 'f'
    and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
    and n.nspname in ('public', 'app')
    and c.confdeltype not in ('c', 'n') $$,
  'toda FK de public/app para auth.users ou profiles é on delete cascade ou set null');

-- ---------------------------------------------------------------------------------------
-- Negado
-- ---------------------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.delete_own_account() $$, '42501', null,
  'visitante anônimo NÃO exclui conta');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', null);
select throws_ok($$ select public.delete_own_account() $$, 'PT401', null,
  'JWT sem session_id: exige entrar de novo (falha fechado)');
-- O amr não conta: login "agora" no amr, sem sessão, continua recusado.
select pg_temp.claims(jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())))));
select throws_ok($$ select public.delete_own_account() $$, 'PT401', null,
  'amr recente (com timestamp decimal) sem sessão NÃO basta');
select pg_temp.claims(jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'session_id', 'nao-e-uuid'));
select throws_ok($$ select public.delete_own_account() $$, 'PT401', null,
  'session_id malformado: PT401, sem erro de conversão');
select pg_temp.claims(jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'session_id', gen_random_uuid()));
select throws_ok($$ select public.delete_own_account() $$, 'PT401', null,
  'session_id de uma sessão que não existe: PT401');
-- Sessão recente de B no JWT de A: não vale.
select pg_temp.claims(jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated',
  'session_id', (select (pg_temp.login('00000000-0000-0000-0000-0000000000a2')))));
select throws_ok($$ select public.delete_own_account() $$, 'PT401', null,
  'sessão recente de outra pessoa no JWT: PT401');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 601);
select throws_ok($$ select public.delete_own_account() $$, 'PT401', null,
  'login de mais de 10 minutos: exige entrar de novo');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1', 3600);
select throws_ok($$ select public.delete_own_account() $$, 'PT401', null,
  'login de 1 hora (sessão renovada): exige entrar de novo');

-- A API não apaga contas nem perfis por fora da função.
select throws_ok($$ delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'a pessoa NÃO apaga o próprio perfil direto pela API');
select throws_ok($$ delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'a pessoa NÃO apaga auth.users direto pela API');

reset role;
select is(pg_temp.rows_of('00000000-0000-0000-0000-0000000000a1'), '1/1/1/1',
  'depois das recusas, nada de A foi apagado');
select is((select count(*)::int from public.audit_log
           where event = 'account_deleted' and target_id = '00000000-0000-0000-0000-0000000000a1'), 0,
  'recusa não grava account_deleted');

-- ---------------------------------------------------------------------------------------
-- C exclui a própria conta: só C sai
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3', 599);
select lives_ok($$ select public.delete_own_account() $$, 'C (login há 9min59s) exclui a própria conta');
reset role;
select is_empty($$ select pg_temp.leftovers('00000000-0000-0000-0000-0000000000a3') $$,
  'nenhum registro com o id de C permanece');
select is(pg_temp.rows_of('00000000-0000-0000-0000-0000000000a1'), '1/1/1/1',
  'a exclusão de C não toca em A (a função não recebe alvo)');

-- ---------------------------------------------------------------------------------------
-- A exclui a própria conta
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.delete_own_account() $$, 'A (login recente) exclui a própria conta');
reset role;

select is_empty($$ select pg_temp.leftovers('00000000-0000-0000-0000-0000000000a1') $$,
  'nenhum registro com o id de A permanece fora do audit_log (perfil, contato, vínculos, papéis, tentativas, aceites, sessões, identidades, rastro do GoTrue)');
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000a1'), 0,
  'auth.users de A apagado');
select is((select array_agg(profile_id) from public.profile_skills
           where profile_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')),
  array['00000000-0000-0000-0000-0000000000a2'::uuid],
  'a habilidade de A some com a conta; a de B fica');
select is((select count(*)::int from auth.sessions where id = '00000000-0000-0000-0000-00000000005a'), 0,
  'sessão de A apagada');
select is((select count(*)::int from auth.audit_log_entries
           where payload ->> 'actor_username' = 'a@exemplo.org'
              or payload -> 'traits' ->> 'user_email' = 'a@exemplo.org'), 0,
  'o e-mail de A não fica no rastro do GoTrue (nem nas entradas ligadas só pelo e-mail)');
select is((select string_agg(payload ->> 'actor_username', ',' order by payload ->> 'actor_username')
           from auth.audit_log_entries where payload ->> 'action' = 'user_recovery_requested'),
  'A@exemplo.org,xa@exemplo.org', 'entradas de outro e-mail (parecido) ficam: igualdade exata');

-- account_deleted: sem dado pessoal (só o id solto, a data e o evento).
select is(
  (select count(*)::int from public.audit_log
   where event = 'account_deleted'
     and actor_id = '00000000-0000-0000-0000-0000000000a1'
     and target_id = '00000000-0000-0000-0000-0000000000a1'
     and item_count is null and reason is null and term_version is null),
  1,
  'account_deleted gravado com ator e alvo = o id apagado, sem mais nada'
);
select is((select count(*)::int from public.audit_log
           where '00000000-0000-0000-0000-0000000000a1' in (actor_id, target_id)),
  3, 'os eventos antigos sobre A continuam no audit_log (só inserções)');

-- ---------------------------------------------------------------------------------------
-- B não é afetado
-- ---------------------------------------------------------------------------------------
select is(pg_temp.rows_of('00000000-0000-0000-0000-0000000000a2'), '1/1/1/1',
  'B mantém perfil, contato, vínculo e papel');
select is(
  (select granted_by from public.role_assignments where profile_id = '00000000-0000-0000-0000-0000000000a2'),
  null, 'o papel de B concedido por A fica, sem a referência a A');
select is(
  (select ended_by from public.unit_members
   where profile_id = '00000000-0000-0000-0000-0000000000a2'),
  null, 'o vínculo encerrado de B fica encerrado, sem a referência a A');
select is(
  (select (left_at is not null) from public.unit_members where profile_id = '00000000-0000-0000-0000-0000000000a2'),
  true, 'o vínculo de B continua encerrado');
select is(
  (select ended_by from public.house_members where profile_id = '00000000-0000-0000-0000-0000000000a2'),
  null, 'o vínculo de casa encerrado de B fica, sem a referência a A (ADR 0011)');
select is(
  (select (left_at is not null) from public.house_members where profile_id = '00000000-0000-0000-0000-0000000000a2'),
  true, 'o vínculo de casa de B continua encerrado');
select is((select count(*)::int from auth.audit_log_entries where payload::text like '%b@exemplo.org%'), 1,
  'o rastro do GoTrue de B fica');

-- ---------------------------------------------------------------------------------------
-- Quem ainda não tem perfil e quem está na espera também excluem (LGPD vale para todos)
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.delete_own_account() $$, 'quem entrou e ainda não tem perfil exclui a conta');
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.delete_own_account() $$, 'quem está na espera exclui a conta');
reset role;
select is_empty($$
  select pg_temp.leftovers('00000000-0000-0000-0000-0000000000a4')
  union all select pg_temp.leftovers('00000000-0000-0000-0000-0000000000a5') $$,
  'nada fica de quem não tinha perfil nem de quem estava na espera (inclusive o HMAC da espera)');

-- Repetir com o JWT antigo (conta já apagada) é recusado.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.delete_own_account() $$, '42501', null,
  'JWT de conta já apagada NÃO exclui de novo');

-- O JWT de A continua válido até expirar: nenhuma função grava com o uuid morto.
reset role;
create temporary table audit_before as
  select count(*)::int as n from public.audit_log;
set local role authenticated;
select throws_ok($$ select public.export_own_data() $$, '42501', null,
  'JWT de conta apagada NÃO exporta (nem grava data_exported)');
select throws_ok($$ select public.save_own_profile(pg_temp.enc('Nova'), 3550308, null, pg_temp.enc('Zap'), repeat('c', 64), null) $$,
  '42501', null, 'JWT de conta apagada NÃO recria o perfil (o aceite do termo foi apagado junto)');
select throws_ok($$ select public.accept_house('casa-exemplo-1', 'self', null) $$, '42501', null,
  'JWT de conta apagada NÃO escolhe casa');
select throws_ok($$ select public.record_questionnaire_consent((select version from app.questionnaire_term_versions limit 1)) $$,
  '42501', null, 'JWT de conta apagada NÃO aceita o termo do questionário');
reset role;
select is((select count(*)::int from public.audit_log), (select n from audit_before),
  'nenhum evento novo no audit_log depois das tentativas');
select is((select count(*)::int from public.consent_acceptances where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'a exclusão da conta apaga os aceites do termo');
select is((select count(*)::int from public.consent_acceptances where user_id = '00000000-0000-0000-0000-0000000000a2'),
  1, 'os aceites de outra pessoa ficam');
select throws_ok($$ insert into public.audit_log (actor_id, event, target_id)
  values ('00000000-0000-0000-0000-0000000000a1', 'data_exported', '00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'nem o dono do banco grava evento com o uuid de conta apagada como ator');
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------------------------------
-- audit_log continua só-inserção
-- ---------------------------------------------------------------------------------------
select throws_ok($$ delete from public.audit_log where event = 'account_deleted' $$, '42501', null,
  'a API NÃO apaga account_deleted');
select throws_ok($$ update public.audit_log set actor_id = null where event = 'account_deleted' $$, '42501', null,
  'a API NÃO pseudonimiza/altera o audit_log');
reset role;
select throws_ok($$ delete from public.audit_log where event = 'account_deleted' $$, '42501',
  'audit_log só aceita inserções', 'nem o dono do banco apaga do audit_log (trigger intacto)');

select * from finish();
rollback;
