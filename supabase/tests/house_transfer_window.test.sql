-- Janela de transferência de casa (issue #302, ADR 0016): um estado aberto/fechado, sem datas, que só a
-- coordenação nacional (gestor da raiz) liga e desliga. Aberta, quem quiser troca a própria casa
-- (`accept_house`); fechada, não (C7605). A coordenação nacional troca a casa de alguém a qualquer
-- momento (`coordination_set_house`); gestor de estado e coordenador de casa não. Abrir, fechar e
-- toda troca vão para o audit_log. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select path::text, id from public.units where path::text in ('br', 'br.sp');
create function pg_temp.unit(p_path text) returns uuid language sql stable as $$ select id from unit_ids where slug = p_path $$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000d1', 'root.mgr@exemplo.org'), -- coordenação nacional
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000d2', 'sp.mgr@exemplo.org'),   -- gestor de SP (não é nacional)
  ('coord',    '00000000-0000-0000-0000-0000000000d3', 'coord@exemplo.org'),    -- coordenador da casa X em SP
  ('p_a',      '00000000-0000-0000-0000-0000000000d4', 'p.a@exemplo.org'),      -- SP, casa X aceita
  ('p_b',      '00000000-0000-0000-0000-0000000000d5', 'p.b@exemplo.org'),      -- SP, casa X aceita
  ('p_new',    '00000000-0000-0000-0000-0000000000d6', 'p.new@exemplo.org');    -- SP, ainda sem casa
insert into auth.users (id, email) select id, email from people;

create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people, unit_ids to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people);

insert into public.houses (key, active) values ('casa-x', true), ('casa-y', true), ('casa-off', false)
on conflict (key) do update set active = excluded.active;
insert into public.role_assignments (profile_id, role, unit_id, house_key) values
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br'), null),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('br.sp'), null),
  (pg_temp.person('coord'), 'house_coordinator', pg_temp.unit('br.sp'), 'casa-x');
-- Membro de verdade exige a casa aceita (ADR 0017): quem tem papel ganha uma casa só dele.
insert into public.houses (key, active) select 'g-' || profile_id::text, true from (select distinct profile_id from public.role_assignments) as r on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select r.profile_id, 'g-' || r.profile_id::text, 'self', now() from (select distinct profile_id from public.role_assignments) as r
where not exists (select 1 from public.house_members as h where h.profile_id = r.profile_id and h.left_at is null) on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at) values
  (pg_temp.person('p_a'), 'casa-x', 'self', now()),
  (pg_temp.person('p_b'), 'casa-x', 'self', now());

-- ---------------------------------------------------------------------------------------
-- Estrutura: sem trava individual, janela como um estado único
-- ---------------------------------------------------------------------------------------
select hasnt_column('public', 'house_members', 'locked_until', 'a trava individual de 4 meses não existe mais');
select hasnt_function('app', 'house_lock_interval', 'nem o intervalo da trava');
select columns_are('public', 'house_transfer_window', array['singleton', 'is_open', 'changed_at', 'changed_by'],
  'a janela guarda só o estado, quando e quem mudou (sem datas de prazo)');
select is((select count(*)::int from public.house_transfer_window), 1, 'há uma só linha de estado');
select is((select is_open from public.house_transfer_window), false, 'a janela nasce fechada');
select ok(
  not has_table_privilege('authenticated', 'public.house_transfer_window', 'insert')
  and not has_table_privilege('authenticated', 'public.house_transfer_window', 'update')
  and not has_table_privilege('authenticated', 'public.house_transfer_window', 'delete')
  and not has_function_privilege('anon', 'public.set_house_transfer_window(boolean)', 'execute'),
  'o estado só muda pela função; anônimo não a chama'
);

select ok(
  has_column_privilege('authenticated', 'public.house_transfer_window', 'is_open', 'select')
  and not has_column_privilege('authenticated', 'public.house_transfer_window', 'changed_by', 'select')
  and not has_column_privilege('authenticated', 'public.house_transfer_window', 'changed_at', 'select'),
  'o membro lê só is_open; quem mudou fica no audit_log, não na tabela'
);
select ok(
  pg_get_functiondef('public.accept_house(text, text, text)'::regprocedure) ~* 'house_transfer_window[^;]*for share',
  'accept_house lê a janela com FOR SHARE: um fechamento concorrente não deixa passar a troca'
);
select ok(
  pg_get_functiondef('public.set_house_transfer_window(boolean)'::regprocedure) ~* 'update public.house_transfer_window[^;]*where singleton',
  'o UPDATE da janela tem WHERE (o PostgREST usa pg-safeupdate e recusa UPDATE sem WHERE)'
);

-- ---------------------------------------------------------------------------------------
-- Janela fechada: ninguém troca por conta própria; a primeira escolha é livre
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('p_a');
select is((select is_open from public.house_transfer_window), false, 'quem é membro lê o estado da janela');
select throws_ok($$ select public.accept_house('casa-y', 'self', null) $$, 'C7605', null,
  'janela fechada: a pessoa não troca de casa');
select is(public.accept_house('casa-x', 'self', null),
  (select id from public.house_members where profile_id = pg_temp.person('p_a') and left_at is null),
  'repetir a mesma casa continua devolvendo o vínculo (clique repetido)');
select throws_ok($$ update public.house_transfer_window set is_open = true $$, '42501', null,
  'a pessoa não abre a janela direto na tabela');
select throws_ok($$ select public.set_house_transfer_window(true) $$, '42501', null,
  'a pessoa comum não abre a janela');
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.set_house_transfer_window(true) $$, '42501', null,
  'gestor de estado não abre a janela: só a coordenação nacional');
select pg_temp.login('coord');
select throws_ok($$ select public.set_house_transfer_window(true) $$, '42501', null,
  'coordenador de casa não abre a janela');
set local role anon;
select throws_ok($$ select public.set_house_transfer_window(true) $$, '42501', null, 'anônimo não abre a janela');
set local role authenticated;
select pg_temp.login('p_new');
select isnt(public.accept_house('casa-y', 'self', null), null,
  'janela fechada: quem ainda não tem casa escolhe a primeira livremente');

-- ---------------------------------------------------------------------------------------
-- A coordenação nacional abre; abrir e fechar vão para o audit_log; só a nacional troca por cima
-- ---------------------------------------------------------------------------------------
select pg_temp.login('root_mgr');
select is(public.set_house_transfer_window(true), true, 'a nacional abre a janela');
select is(public.set_house_transfer_window(true), true, 'abrir de novo é idempotente');
select is((select is_open from public.house_transfer_window), true, 'o estado ficou aberto');
reset role;
select is((select changed_by from public.house_transfer_window), pg_temp.person('root_mgr'), 'guarda quem mudou (só o dono lê a coluna)');
select is(
  (select count(*)::int from public.audit_log where event = 'house_window_opened' and actor_id = pg_temp.person('root_mgr')),
  1, 'abrir grava um evento, com o ator, e repetir não grava outro'
);

set local role authenticated;
select pg_temp.login('p_a');
select isnt(public.accept_house('casa-y', 'self', null), null, 'janela aberta: a pessoa troca para a casa Y');
select is(
  (select array_agg(house_key order by house_key) from public.house_members where profile_id = pg_temp.person('p_a') and left_at is null),
  array['casa-y'], 'um só vínculo aberto, na casa nova'
);
select throws_ok($$ select public.accept_house('casa-off', 'self', null) $$, 'P0002', null, 'casa inativa continua recusada');
select isnt(public.accept_house('casa-x', 'self', null), null, 'aberta, a pessoa pode trocar de novo (sem trava individual)');
reset role;
select is(
  (select count(*)::int from public.audit_log
   where event = 'house_changed' and actor_id = pg_temp.person('p_a') and target_id = pg_temp.person('p_a') and reason = 'self'),
  2, 'cada troca da pessoa vai para o audit_log (motivo self)'
);

-- Fechar: volta a recusar.
set local role authenticated;
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.set_house_transfer_window(false) $$, '42501', null, 'gestor de estado também não fecha');
select pg_temp.login('root_mgr');
select is(public.set_house_transfer_window(false), false, 'a nacional fecha a janela');
reset role;
select is(
  (select count(*)::int from public.audit_log where event = 'house_window_closed' and actor_id = pg_temp.person('root_mgr')),
  1, 'fechar grava o evento, com o ator'
);
set local role authenticated;
select pg_temp.login('p_a');
select throws_ok($$ select public.accept_house('casa-y', 'self', null) $$, 'C7605', null, 'fechada de novo: a pessoa não troca');

-- ---------------------------------------------------------------------------------------
-- A coordenação nacional troca a casa de qualquer pessoa, com a janela fechada; ninguém mais
-- ---------------------------------------------------------------------------------------
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.coordination_set_house(pg_temp.person('p_b'), 'casa-y') $$, '42501', null,
  'gestor de estado, mesmo com alcance de gestão, não troca a casa de ninguém');
select pg_temp.login('coord');
select throws_ok($$ select public.coordination_set_house(pg_temp.person('p_b'), 'casa-y') $$, '42501', null,
  'coordenador da casa não troca a casa de ninguém');
select pg_temp.login('p_b');
select throws_ok($$ select public.coordination_set_house(pg_temp.person('p_b'), 'casa-y') $$, '42501', null,
  'a pessoa não troca a própria casa pela função da coordenação');
select pg_temp.login('root_mgr');
select throws_ok($$ select public.coordination_set_house(pg_temp.person('p_b'), 'casa-off') $$, 'P0002', null,
  'a casa nova precisa existir e estar ativa');
select throws_ok($$ select public.coordination_set_house(pg_temp.person('root_mgr'), 'casa-y') $$, '42501', null,
  'a nacional não troca a própria casa por esta função');
select isnt(public.coordination_set_house(pg_temp.person('p_b'), 'casa-y'), null,
  'a nacional troca a casa de p_b com a janela fechada');
reset role;
select is(
  (select count(*)::int from public.audit_log
   where event = 'house_changed' and actor_id = pg_temp.person('root_mgr')
     and target_id = pg_temp.person('p_b') and house_key = 'casa-y' and reason = 'coordination'),
  1, 'a troca da nacional vai para o audit_log, com quem trocou'
);
select ok(
  pg_get_functiondef('public.coordination_set_house(uuid, text)'::regprocedure) like '%manages_root%'
  and pg_get_functiondef('public.coordination_set_house(uuid, text)'::regprocedure) not like '%can_manage_house_member%',
  'coordination_set_house exige a coordenação nacional (manages_root), não mais o alcance de gestão'
);

-- ---------------------------------------------------------------------------------------
-- Leitura da auditoria da janela e Baixar meus dados
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('root_mgr');
select is((select count(*)::int from public.audit_log where event in ('house_window_opened', 'house_window_closed')), 2,
  'a nacional lê os eventos da janela');
select pg_temp.login('sp_mgr');
select is((select count(*)::int from public.audit_log where event in ('house_window_opened', 'house_window_closed')), 0,
  'gestor de estado não lê os eventos da janela');
select pg_temp.login('p_b');
select ok(
  not exists (select 1 from jsonb_array_elements(public.export_own_data() -> 'house_memberships') as m where m ? 'locked_until'),
  'Baixar meus dados não traz mais locked_until'
);
select ok(
  exists (
    select 1 from jsonb_array_elements(public.export_own_data() -> 'audit_events') as e
    where e ->> 'event' = 'house_changed' and e ->> 'reason' = 'coordination'
  ),
  'Baixar meus dados traz a troca feita pela coordenação'
);

select * from finish();
rollback;
