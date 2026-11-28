-- Novidades na página inicial (issue #307): `public.news`, `publish_news` e `archive_news`.
-- Quem publica: gestor com escopo sobre a unidade. Quem lê: membro ativo cuja unidade é a da novidade ou fica abaixo
-- dela (nível dele e acima). Sem escrita direta; link só https com domínio; texto puro; audit sem o texto.
-- Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('nat',   '00000000-0000-0000-0000-0000000000c1', 'nat@exemplo.org'),   -- gestor da raiz
  ('reg',   '00000000-0000-0000-0000-0000000000c2', 'reg@exemplo.org'),   -- gestor da unidade filha A
  ('ma',    '00000000-0000-0000-0000-0000000000c3', 'ma@exemplo.org'),    -- membro na unidade filha A
  ('mb',    '00000000-0000-0000-0000-0000000000c4', 'mb@exemplo.org'),    -- membro na unidade filha B (irmã)
  ('wl',    '00000000-0000-0000-0000-0000000000c5', 'wl@exemplo.org'),    -- na espera, na unidade A
  ('susp',  '00000000-0000-0000-0000-0000000000c6', 'susp@exemplo.org');  -- suspenso, na unidade A
insert into auth.users (id, email) select id, email from people;
create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
-- A raiz que a estrutura da instância já criou; as duas filhas de teste ficam sob ela.
create function pg_temp.root() returns uuid language sql stable as $$ select id from public.units where parent_id is null $$;
create function pg_temp.ua() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e002'::uuid $$;
create function pg_temp.ub() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000e003'::uuid $$;
grant select on people to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people where name <> 'wl');
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('wl');
update public.profiles set status = 'suspended' where id = pg_temp.person('susp');

insert into public.houses (key, active) values ('casa-n', true) on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'casa-n', 'self', now() from people;

insert into public.unit_types (key, label, level) values ('ntest', 'Tipo teste', 9) on conflict do nothing;
insert into public.units (id, type_id, parent_id, slug, name, path)
select '00000000-0000-0000-0000-00000000e002', t.id, pg_temp.root(), 'nta', 'Filha A', 'x' from public.unit_types as t where t.key = 'ntest';
insert into public.units (id, type_id, parent_id, slug, name, path)
select '00000000-0000-0000-0000-00000000e003', t.id, pg_temp.root(), 'ntb', 'Filha B', 'x' from public.unit_types as t where t.key = 'ntest';
-- Ao ativar a pessoa, um gatilho já pode ter aberto um vínculo (a unidade do estado): parte-se do zero.
delete from public.unit_members where profile_id in (select id from people);
insert into public.unit_members (profile_id, unit_id) values
  (pg_temp.person('ma'),   pg_temp.ua()),
  (pg_temp.person('reg'),  pg_temp.ua()), -- o gestor da A também é membro da A (precisa ver a novidade para arquivá-la)
  (pg_temp.person('wl'),   pg_temp.ua()),
  (pg_temp.person('susp'), pg_temp.ua()),
  (pg_temp.person('mb'),   pg_temp.ub());
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('nat'), 'manager', pg_temp.root()),
  (pg_temp.person('reg'), 'manager', pg_temp.ua());

-- ---------------------------------------------------------------------------------------
-- Forma e privilégios
-- ---------------------------------------------------------------------------------------
select has_table('public', 'news', 'a tabela existe');
select ok((select relrowsecurity from pg_class where oid = 'public.news'::regclass), 'RLS ligada');
select ok(not has_table_privilege('authenticated', 'public.news', 'insert')
  and not has_table_privilege('authenticated', 'public.news', 'update')
  and not has_table_privilege('authenticated', 'public.news', 'delete'), 'ninguém escreve direto');
select ok(not has_function_privilege('anon', 'public.publish_news(uuid,text,text,text,timestamptz)', 'execute'), 'anon não publica');
select ok(not has_function_privilege('anon', 'public.archive_news(uuid)', 'execute'), 'anon não arquiva');

-- ---------------------------------------------------------------------------------------
-- Quem publica
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('ma');
select throws_ok($$ select public.publish_news(pg_temp.ua(), 'Título', 'Texto', null, null) $$, '42501', null, 'membro comum NÃO publica');
select pg_temp.login('reg');
select throws_ok($$ select public.publish_news(pg_temp.ub(), 'Título', 'Texto', null, null) $$, '42501', null, 'gestor da A NÃO publica na B (irmã)');
select throws_ok($$ select public.publish_news(pg_temp.root(), 'Título', 'Texto', null, null) $$, '42501', null, 'gestor da A NÃO publica na raiz (acima)');
select lives_ok($$ select public.publish_news(pg_temp.ua(), 'Encontro da A', 'Sábado, 10h.', 'https://exemplo.org/encontro', null) $$, 'gestor da A publica na A');
select pg_temp.login('nat');
select lives_ok($$ select public.publish_news(pg_temp.root(), 'Aviso nacional', 'Para todos.', null, null) $$, 'gestor da raiz publica na raiz');
select lives_ok($$ select public.publish_news(pg_temp.ub(), 'Só da B', 'Texto da B.', null, null) $$, 'gestor da raiz publica na B (abaixo)');

-- Validação do conteúdo
select throws_ok($$ select public.publish_news(pg_temp.root(), '', 'Texto', null, null) $$, '22023', null, 'título vazio é recusado');
select throws_ok($$ select public.publish_news(pg_temp.root(), repeat('x', 81), 'Texto', null, null) $$, '22023', null, 'título com mais de 80 é recusado');
select throws_ok($$ select public.publish_news(pg_temp.root(), 'T', repeat('x', 281), null, null) $$, '22023', null, 'texto com mais de 280 é recusado');
select throws_ok($$ select public.publish_news(pg_temp.root(), 'T', '<b>oi</b>', null, null) $$, '22023', null, 'HTML no texto é recusado');
select throws_ok($$ select public.publish_news(pg_temp.root(), 'T', 'Texto', 'http://exemplo.org', null) $$, '22023', null, 'link http (sem s) é recusado');
select throws_ok($$ select public.publish_news(pg_temp.root(), 'T', 'Texto', 'https://localhost/x', null) $$, '22023', null, 'link sem domínio válido é recusado');
select throws_ok($$ select public.publish_news(pg_temp.root(), 'T', 'Texto', null, now() - interval '1 day') $$, '22023', null, 'validade no passado é recusada');

-- ---------------------------------------------------------------------------------------
-- Quem lê: o próprio nível e acima
-- ---------------------------------------------------------------------------------------
select pg_temp.login('ma');
select is((select count(*)::int from public.news), 2, 'membro da A vê a da A e a nacional, não a da B');
select pg_temp.login('mb');
select is((select count(*)::int from public.news where title = 'Só da B'), 1, 'membro da B vê a da B');
select pg_temp.login('wl');
select is((select count(*)::int from public.news), 0, 'quem está na espera não vê');
select pg_temp.login('susp');
select is((select count(*)::int from public.news), 0, 'suspenso não vê');

-- ---------------------------------------------------------------------------------------
-- Arquivar e auditar
-- ---------------------------------------------------------------------------------------
select pg_temp.login('ma');
select throws_ok($$ select public.archive_news((select id from public.news where title = 'Encontro da A')) $$, '42501', null, 'membro comum NÃO arquiva');
select pg_temp.login('reg');
select lives_ok($$ select public.archive_news((select id from public.news where title = 'Encontro da A')) $$, 'gestor da A arquiva a da A');
select pg_temp.login('ma');
select is((select count(*)::int from public.news where title = 'Encontro da A'), 0, 'arquivada some para o membro');

reset role;
select is((select count(*)::int from public.audit_log where event = 'news_published'), 3, 'cada publicação grava news_published');
select is((select count(*)::int from public.audit_log where event = 'news_archived'), 1, 'arquivar grava news_archived');

select * from finish();
rollback;
