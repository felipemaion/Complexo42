-- Bootstrap da primeira coordenação (issue #295): `app.bootstrap_root_manager(hmac, email, adicionar_outro)`.
-- Função só do operador (supabase_admin): põe o HMAC do e-mail na lista de autorizados, libera quem
-- espera e cria o papel de gestor na raiz. Pessoas e HMACs fictícios, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

create function pg_temp.h(p_tag text) returns text language sql as $$
  select encode(sha256(convert_to(p_tag, 'UTF8')), 'hex')
$$;
create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.root() returns uuid language sql stable as $$
  select id from public.units where parent_id is null
$$;
create function pg_temp.roles(p_who uuid) returns integer language sql stable as $$
  select count(*)::int from public.role_assignments
  where profile_id = p_who and role = 'manager' and unit_id = pg_temp.root() and revoked_at is null
$$;

-- Pessoas: o e-mail fica em auth.users (como no GoTrue), o perfil em public.profiles.
create temp table people (name text primary key, id uuid not null unique, email text, confirmed boolean);
insert into people values
  ('ana',  '00000000-0000-0000-0000-0000000000d1', 'Ana.Teste@Exemplo.org', true),   -- ativa, e-mail com maiúsculas
  ('bia',  '00000000-0000-0000-0000-0000000000d2', 'bia@exemplo.org', true),         -- ativa
  ('caio', '00000000-0000-0000-0000-0000000000d3', 'caio@exemplo.org', true),        -- na espera
  ('dani', '00000000-0000-0000-0000-0000000000d4', 'dani@exemplo.org', true),        -- bloqueada
  ('edu',  '00000000-0000-0000-0000-0000000000d5', 'edu@exemplo.org', false),        -- e-mail não confirmado
  ('fabi', '00000000-0000-0000-0000-0000000000d6', 'fabi@exemplo.org', true);        -- ativa
insert into auth.users (id, email, email_confirmed_at)
select id, email, case when confirmed then now() end from people;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc(name), 3550308, 'v1' from people;
update public.profiles set access_status = 'active', status = 'active'
where id in (select id from people where name in ('ana', 'bia', 'edu', 'fabi'));
update public.profiles set access_status = 'waitlisted' where id = (select id from people where name = 'caio');
update public.profiles set access_status = 'blocked' where id = (select id from people where name = 'dani');
insert into public.access_waitlist_hmac (profile_id, email_hmac)
select id, pg_temp.h('caio@exemplo.org') from people where name = 'caio';
create function pg_temp.person(p_name text) returns uuid language sql stable as $$
  select id from people where name = p_name
$$;
grant select on people to authenticated;

-- ---------------------------------------------------------------------------------------
-- Privilégios: só o operador
-- ---------------------------------------------------------------------------------------
select has_function('app', 'bootstrap_root_manager', array['text', 'text', 'boolean'], 'a função existe');
select ok(not has_function_privilege('anon', 'app.bootstrap_root_manager(text,text,boolean)', 'execute'), 'anon não executa');
select ok(not has_function_privilege('authenticated', 'app.bootstrap_root_manager(text,text,boolean)', 'execute'), 'authenticated não executa');
select ok(not has_function_privilege('service_role', 'app.bootstrap_root_manager(text,text,boolean)', 'execute'), 'service_role não executa');
set local role authenticated;
select throws_ok(
  format($$ select app.bootstrap_root_manager(%L, 'x@exemplo.org', false) $$, pg_temp.h('x')),
  '42501', null, 'quem chama pela API é recusado');
reset role;

-- Entradas inválidas
select throws_ok(
  $$ select app.bootstrap_root_manager('nao-e-hmac', 'x@exemplo.org', false) $$,
  '22023', null, 'HMAC fora do formato é recusado');
select throws_ok(
  format($$ select app.bootstrap_root_manager(%L, 'sem-arroba', false) $$, pg_temp.h('x')),
  '22023', null, 'e-mail inválido é recusado');

-- ---------------------------------------------------------------------------------------
-- Raiz sem gestor, pessoa ainda sem perfil: só entra na lista
-- ---------------------------------------------------------------------------------------
select is(
  app.bootstrap_root_manager(pg_temp.h('novo@exemplo.org'), 'novo@exemplo.org', false),
  jsonb_build_object('allowlisted', true, 'promoted', 0, 'role', 'waiting_profile'),
  'sem perfil: entra na lista e espera o primeiro acesso');
select is(
  (select count(*)::int from public.access_allowlist
   where email_hmac = pg_temp.h('novo@exemplo.org') and source = 'manual' and added_by is null),
  1, 'a lista guarda só o HMAC, origem manual e sem autor (operador)');
select is(
  (select count(*)::int from public.audit_log
   where event = 'allowlist_imported' and reason = 'manual' and item_count = 1 and actor_id is null),
  1, 'auditoria: allowlist_imported, motivo manual, 1 item');
select is(
  (select count(*)::int from public.role_assignments where role = 'manager' and unit_id = pg_temp.root() and revoked_at is null),
  0, 'ninguém ganha papel sem perfil');

-- Idempotente
select is(
  app.bootstrap_root_manager(pg_temp.h('novo@exemplo.org'), 'novo@exemplo.org', false),
  jsonb_build_object('allowlisted', false, 'promoted', 0, 'role', 'waiting_profile'),
  'repetir não acrescenta nada');
select is((select count(*)::int from public.access_allowlist where email_hmac = pg_temp.h('novo@exemplo.org')), 1,
  'a lista segue com uma linha só');
select is((select count(*)::int from public.audit_log where event = 'allowlist_imported'), 1,
  'repetir não gera outra auditoria');

-- ---------------------------------------------------------------------------------------
-- Pessoa com perfil ativo: ganha o papel na raiz (e-mail comparado sem diferenciar maiúsculas)
-- ---------------------------------------------------------------------------------------
select is(
  app.bootstrap_root_manager(pg_temp.h('ana.teste@exemplo.org'), 'ana.teste@exemplo.org', false)->>'role',
  'granted', 'perfil ativo: papel concedido');
select is(pg_temp.roles(pg_temp.person('ana')), 1, 'um papel de gestor ativo na raiz');
select is(
  (select count(*)::int from public.role_assignments
   where profile_id = pg_temp.person('ana') and role = 'manager' and granted_by is null),
  1, 'o papel nasce sem autor (operador), nunca apontando para a própria pessoa');
select is(
  (select count(*)::int from public.audit_log where event = 'role_granted' and target_id = pg_temp.person('ana') and actor_id is null),
  1, 'auditoria: role_granted com o alvo e sem autor');
select is(
  app.bootstrap_root_manager(pg_temp.h('ana.teste@exemplo.org'), 'ana.teste@exemplo.org', false)->>'role',
  'already', 'repetir para o mesmo gestor é neutro (já tinha)');
select is(pg_temp.roles(pg_temp.person('ana')), 1, 'rodar duas vezes não cria dois papéis');
select is(
  (select count(*)::int from public.audit_log where event = 'role_granted' and target_id = pg_temp.person('ana')),
  1, 'repetir não audita de novo');

-- ---------------------------------------------------------------------------------------
-- Raiz já tem gestor: recusa, a não ser com a flag
-- ---------------------------------------------------------------------------------------
select throws_ok(
  format($$ select app.bootstrap_root_manager(%L, 'bia@exemplo.org', false) $$, pg_temp.h('bia@exemplo.org')),
  'P0001', 'a raiz já tem gestor ativo; use a flag para acrescentar outro',
  'com gestor na raiz e sem a flag, recusa');
select is((select count(*)::int from public.access_allowlist where email_hmac = pg_temp.h('bia@exemplo.org')), 0,
  'a recusa não grava na lista');
select is(pg_temp.roles(pg_temp.person('bia')), 0, 'a recusa não dá papel');
select is(
  app.bootstrap_root_manager(pg_temp.h('bia@exemplo.org'), 'bia@exemplo.org', true)->>'role',
  'granted', 'com a flag, acrescenta outro gestor');
select is(
  (select count(*)::int from public.role_assignments where role = 'manager' and unit_id = pg_temp.root() and revoked_at is null),
  2, 'a flag acrescenta, não substitui');

-- ---------------------------------------------------------------------------------------
-- Quem espera (caso do staging) é liberado como na importação e ganha o papel
-- ---------------------------------------------------------------------------------------
select is(
  app.bootstrap_root_manager(pg_temp.h('caio@exemplo.org'), 'caio@exemplo.org', true),
  jsonb_build_object('allowlisted', true, 'promoted', 1, 'role', 'granted'),
  'quem esperava é liberado e vira gestor');
select is((select access_status from public.profiles where id = pg_temp.person('caio')), 'active', 'o perfil passou a ativo');
select is((select count(*)::int from public.access_waitlist_hmac where profile_id = pg_temp.person('caio')), 0,
  'o HMAC sai da fila de espera');
select is(
  (select count(*)::int from public.audit_log
   where event = 'access_granted' and reason = 'manual' and target_id = pg_temp.person('caio') and actor_id is null),
  1, 'auditoria: access_granted, motivo manual');
-- O papel só vale para quem é membro de verdade (termo, perfil completo e casa aceita):
-- sem isso, a pessoa liberada ainda não importa a lista.
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.person('caio'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.import_allowlist(array[%L], 'manual') $$, pg_temp.h('qualquer')),
  '42501', null, 'o papel só passa a valer depois de termo, perfil e casa (membro ativo)');
reset role;

-- ---------------------------------------------------------------------------------------
-- Bloqueada, e-mail não confirmado: nada de papel
-- ---------------------------------------------------------------------------------------
select is(
  app.bootstrap_root_manager(pg_temp.h('dani@exemplo.org'), 'dani@exemplo.org', true)->>'role',
  'not_active', 'perfil bloqueado não ganha papel');
select is(pg_temp.roles(pg_temp.person('dani')), 0, 'sem papel para bloqueada');
select is((select access_status from public.profiles where id = pg_temp.person('dani')), 'blocked',
  'o bloqueio continua');
select is(
  app.bootstrap_root_manager(pg_temp.h('edu@exemplo.org'), 'edu@exemplo.org', true)->>'role',
  'waiting_profile', 'e-mail não confirmado não identifica ninguém');
select is(pg_temp.roles(pg_temp.person('edu')), 0, 'sem papel sem confirmação do e-mail');

-- ---------------------------------------------------------------------------------------
-- Só gestor ativo conta: com todos revogados, a raiz volta a aceitar sem a flag
-- ---------------------------------------------------------------------------------------
update public.role_assignments set revoked_at = now()
where role = 'manager' and unit_id = pg_temp.root() and revoked_at is null;
select is(
  app.bootstrap_root_manager(pg_temp.h('fabi@exemplo.org'), 'fabi@exemplo.org', false)->>'role',
  'granted', 'sem gestor ativo na raiz, não precisa da flag');
select is(pg_temp.roles(pg_temp.person('fabi')), 1, 'a nova gestora tem o papel');

-- Privacidade: nenhum e-mail em claro nas tabelas de lista e auditoria
select is((select count(*)::int from public.audit_log a where a::text ilike '%@%'), 0,
  'auditoria sem e-mail em claro');
select is((select count(*)::int from public.access_allowlist l where l::text ilike '%@%'), 0,
  'lista sem e-mail em claro');

select * from finish();
rollback;
