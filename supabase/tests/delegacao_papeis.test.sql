-- Delegação de papéis por escopo (#22, ADR 0002): toda concessão e toda revogação deixam exatamente uma linha no `audit_log`
-- (ator e alvo, nada mais), `revoked_by` é do banco (não forjável) e `public.grant_role_by_email` concede por e-mail com
-- resposta neutra: e-mail desconhecido, pessoa fora do escopo e papel não permitido dão o mesmo resultado (nada).
-- Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Uma região abaixo de SP (as 27 unidades de estado vêm da migration).
insert into public.units (type_id, parent_id, slug, name, path)
select t.id, u.id, 'abc22', 'ABC 22', 'abc22'::extensions.ltree
from public.unit_types t, public.units u where t.key = 'region' and u.state_code = 'SP';

create temp table people (name text primary key, id uuid not null unique, email text not null, municipality integer not null);
insert into people values
  ('nat',  '00000000-0000-0000-0000-0000000000e1', 'nat22@exemplo.org', 3550308),   -- manager nacional
  ('spm',  '00000000-0000-0000-0000-0000000000e2', 'spm22@exemplo.org', 3550308),   -- manager de SP
  ('ana',  '00000000-0000-0000-0000-0000000000e3', 'ana22@exemplo.org', 3550308),   -- membro de SP
  ('bia',  '00000000-0000-0000-0000-0000000000e4', 'bia22@exemplo.org', 3550308),   -- membro de SP
  ('caio', '00000000-0000-0000-0000-0000000000e5', 'caio22@exemplo.org', 3106200),  -- membro de MG
  ('dani', '00000000-0000-0000-0000-0000000000e6', 'dani22@exemplo.org', 3550308);  -- membro de SP
grant select on people to authenticated;

insert into auth.users (id, email) select id, email from people;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.' || rpad(name, 22, 'x'), municipality, 'v1' from people;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people);
insert into public.consent_acceptances (user_id, version) select id, app.current_consent_version() from people;
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at)
select id, 'esparta', 'self', now() - interval '8 days', now() - interval '8 days' from people;

create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.unit(p_code text) returns uuid language sql stable as $$
  select id from public.units where state_code = p_code or (p_code = 'br' and parent_id is null) or slug = p_code limit 1
$$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true)
$$;
create function pg_temp.events(p_event text, p_target text) returns int language sql stable as $$
  select count(*)::int from public.audit_log where event = p_event and target_id = pg_temp.person(p_target)
$$;
create function pg_temp.has_role(p_name text, p_role text, p_unit text) returns boolean language sql stable as $$
  select exists (select 1 from public.role_assignments
                 where profile_id = pg_temp.person(p_name) and role = p_role and unit_id = pg_temp.unit(p_unit) and revoked_at is null)
$$;

-- Os papéis de partida, gravados pelo operador (sem sessão): o gatilho não grava evento (o operador grava à mão).
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('nat'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('spm'), 'manager', pg_temp.unit('SP'));
select is(pg_temp.events('role_granted', 'nat') + pg_temp.events('role_granted', 'spm'), 0,
  'escrita sem sessão (operador, bootstrap) não gera evento pelo gatilho');

set local role authenticated;

-- 1. O nacional dá o papel de manager estadual a quem é de SP.
select pg_temp.login('nat');
select lives_ok($$ select public.grant_role_by_email('ana22@exemplo.org', 'manager', pg_temp.unit('SP')) $$, 'o nacional concede manager em SP');
select ok(pg_temp.has_role('ana', 'manager', 'SP'), 'a pessoa recebe o papel');
select is((select granted_by from public.role_assignments where profile_id = pg_temp.person('ana') and revoked_at is null),
  pg_temp.person('nat'), 'granted_by é quem concedeu');
reset role;
select is(pg_temp.events('role_granted', 'ana'), 1, 'exatamente uma linha de role_granted');
select is((select actor_id from public.audit_log where event = 'role_granted' and target_id = pg_temp.person('ana')),
  pg_temp.person('nat'), 'o ator do evento é quem concedeu');
set local role authenticated;

-- 2. O estadual dá monitor numa região do seu estado.
select pg_temp.login('spm');
select public.grant_role_by_email('bia22@exemplo.org', 'monitor', pg_temp.unit('abc22'));
select ok(pg_temp.has_role('bia', 'monitor', 'abc22'), 'o estadual concede monitor na região do seu estado');

-- 3. Negações, todas neutras (sem erro e sem nada gravado).
select lives_ok($$ select public.grant_role_by_email('dani22@exemplo.org', 'monitor', pg_temp.unit('SP')) $$,
  'mesmo nível: sem erro (resposta neutra)');
select ok(not pg_temp.has_role('dani', 'monitor', 'SP'), 'mesmo nível: não concede');
select public.grant_role_by_email('caio22@exemplo.org', 'monitor', pg_temp.unit('MG'));
select ok(not pg_temp.has_role('caio', 'monitor', 'MG'), 'fora do escopo (outro estado): não concede');
select public.grant_role_by_email('caio22@exemplo.org', 'monitor', pg_temp.unit('abc22'));
select ok(not pg_temp.has_role('caio', 'monitor', 'abc22'), 'pessoa fora do escopo, numa unidade do escopo: não concede');
select public.grant_role_by_email('spm22@exemplo.org', 'monitor', pg_temp.unit('abc22'));
select ok(not pg_temp.has_role('spm', 'monitor', 'abc22'), 'a si mesmo: não concede');
select lives_ok($$ select public.grant_role_by_email('ninguem22@exemplo.org', 'monitor', pg_temp.unit('abc22')) $$,
  'e-mail sem conta: sem erro (não dá para saber se a conta existe)');
select public.grant_role_by_email('dani22@exemplo.org', 'tech_admin', pg_temp.unit('abc22'));
select ok(not pg_temp.has_role('dani', 'tech_admin', 'abc22'), 'papel que não se delega (tech_admin): não concede');
select pg_temp.login('bia');
select public.grant_role_by_email('dani22@exemplo.org', 'monitor', pg_temp.unit('abc22'));
select ok(not pg_temp.has_role('dani', 'monitor', 'abc22'), 'monitor não concede papel nenhum');
reset role;
select is(pg_temp.events('role_granted', 'dani') + pg_temp.events('role_granted', 'caio') + pg_temp.events('role_granted', 'spm'), 0,
  'nenhuma negação deixa evento');
set local role authenticated;

-- 4. Concessão pela API direta (RLS) também deixa rastro, pelo mesmo gatilho.
select pg_temp.login('spm');
insert into public.role_assignments (profile_id, role, unit_id, granted_by)
values (pg_temp.person('dani'), 'spokesperson', pg_temp.unit('abc22'), pg_temp.person('spm'));
reset role;
select is(pg_temp.events('role_granted', 'dani'), 1, 'a escrita direta pela API também gera exatamente uma linha');
set local role authenticated;

-- 5. Revogação: `revoked_by` é quem revogou, uma linha de role_revoked, e revogar de novo não faz nada.
select pg_temp.login('spm');
update public.role_assignments set revoked_at = now()
where profile_id = pg_temp.person('bia') and role = 'monitor' and revoked_at is null;
reset role;
select is((select revoked_by from public.role_assignments where profile_id = pg_temp.person('bia') and role = 'monitor'),
  pg_temp.person('spm'), 'revoked_by é quem revogou (gravado pelo banco)');
select is(pg_temp.events('role_revoked', 'bia'), 1, 'exatamente uma linha de role_revoked');
set local role authenticated;
select pg_temp.login('spm');
update public.role_assignments set revoked_at = now() where profile_id = pg_temp.person('bia') and role = 'monitor';
reset role;
select is(pg_temp.events('role_revoked', 'bia'), 1, 'revogar de novo não grava outra linha');
set local role authenticated;

-- 6. `revoked_by` não é forjável: a API não tem grant de escrita na coluna.
select pg_temp.login('spm');
select throws_ok(
  $$ update public.role_assignments set revoked_by = pg_temp.person('nat') where profile_id = pg_temp.person('dani') $$,
  '42501', null, 'ninguém escreve revoked_by pela API');

-- 7. Limite de tentativas por hora (como o bloqueio), sem guardar o e-mail.
select pg_temp.login('nat');
select lives_ok(
  $$ select public.grant_role_by_email('ninguem22@exemplo.org', 'monitor', pg_temp.unit('abc22')) from generate_series(1, 28) $$,
  'até o limite, tentativas seguem (resposta neutra)'
);
select throws_ok(
  $$ select public.grant_role_by_email('ninguem22@exemplo.org', 'monitor', pg_temp.unit('abc22')) from generate_series(1, 5) $$,
  '54000', null, 'acima de 30 tentativas na hora: recusa'
);
reset role;
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'app' and table_name = 'role_grant_attempts'
     and column_name not in ('actor_id', 'attempted_at')),
  0, 'o contador guarda só quem e quando (nada do e-mail nem do alvo)'
);

select * from finish();
rollback;
