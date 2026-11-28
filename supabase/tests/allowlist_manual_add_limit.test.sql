-- Limite de "autorizar um e-mail à mão" no banco (issue #86): 30 a cada 10 minutos por gestor,
-- contados no audit_log. A importação por arquivo não entra no limite. Pessoas e HMACs fictícios,
-- só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create function pg_temp.h(p_tag text) returns text language sql as $$
  select encode(sha256(convert_to(p_tag, 'UTF8')), 'hex')
$$;

select set_config('test.br', (select id::text from public.units where path = 'br'), true);

create temp table people (name text primary key, id uuid not null unique);
insert into people values
  ('mgr_a', '00000000-0000-0000-0000-0000000008a1'),
  ('mgr_b', '00000000-0000-0000-0000-0000000008a2');
grant select on people to authenticated;
insert into auth.users (id) select id from people;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.' || rpad(name, 22, 'x'), 3550308, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from people on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people);
insert into public.role_assignments (profile_id, role, unit_id)
select id, 'manager', current_setting('test.br')::uuid from people;

create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from people where name = p_name), 'role', 'authenticated')::text, true);
$$;

-- Inclusões de 11 minutos atrás não contam: a janela é de 10 minutos.
insert into public.audit_log (actor_id, event, item_count, reason, created_at)
select (select id from people where name = 'mgr_a'), 'allowlist_imported', 1, 'manual', now() - interval '11 minutes'
from generate_series(1, 30);

set local role authenticated;
select pg_temp.login('mgr_a');

select lives_ok(
  $$ select public.import_allowlist(array[pg_temp.h('m' || g || '@x.org')], 'manual', 'manual')
     from generate_series(1, 30) as g $$,
  'o gestor inclui 30 e-mails à mão em 10 minutos (as de 11 minutos atrás não contam)'
);
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('m31@x.org')], 'manual', 'manual') $$,
  '54000', 'limite de inclusões à mão atingido',
  'a 31ª inclusão à mão em 10 minutos é recusada com 54000'
);
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('m1@x.org')], 'manual', 'manual') $$,
  '54000', 'limite de inclusões à mão atingido',
  'repetir um e-mail que já está na lista também conta (a tentativa é o que se limita)'
);
select lives_ok(
  $$ select public.import_allowlist(array[pg_temp.h('lote@x.org')], 'form', 'import') $$,
  'a importação por arquivo não entra no limite das inclusões à mão'
);
select lives_ok(
  $$ select public.import_allowlist(array[pg_temp.h('lote2@x.org')], 'form') $$,
  'a importação pela assinatura de 2 argumentos também não'
);

select pg_temp.login('mgr_b');
select lives_ok(
  $$ select public.import_allowlist(array[pg_temp.h('b1@x.org')], 'manual', 'manual') $$,
  'o limite é por gestor: outro gestor continua incluindo'
);

reset role;
select is(
  (select count(*)::int from public.audit_log
   where actor_id = (select id from people where name = 'mgr_a')
     and event = 'allowlist_imported' and reason = 'manual'
     and created_at > now() - interval '10 minutes'),
  30,
  'a tentativa recusada não grava auditoria'
);

select * from finish();
rollback;
