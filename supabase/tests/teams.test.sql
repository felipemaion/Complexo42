-- Equipes (#28 e #29): criar, adicionar e remover membros, líder e arquivar. A API não grava direto em units e
-- unit_members; tudo passa por funções que conferem o escopo (can_manage_unit), encerram o vínculo anterior (uma
-- equipe por vez) e gravam `member_moved` com as duas unidades. Pessoas e árvore fictícias, só nesta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

truncate public.questionnaire_data_grants, public.role_assignments, public.unit_members, public.house_members, public.units;

create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns void language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, (select u.id from public.units as u where u.slug = p_parent), p_slug, p_slug, p_state, p_slug::extensions.ltree
  from public.unit_types as t where t.key = p_type
$$;
select pg_temp.add_unit('national', null, 'br');
select pg_temp.add_unit('state', 'br', 'sp', 'SP');
select pg_temp.add_unit('region', 'sp', 'abc');
select pg_temp.add_unit('region', 'sp', 'zl');

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select slug, id from public.units;
grant select on unit_ids to authenticated;
create function pg_temp.unit(p_slug text) returns uuid language sql stable as $$ select id from unit_ids where slug = p_slug $$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('nat',     '00000000-0000-0000-0000-0000000002a1', 'nat@exemplo.org'),     -- gestor nacional
  ('sp_mgr',  '00000000-0000-0000-0000-0000000002a2', 'sp.mgr@exemplo.org'),  -- gestor de SP
  ('abc_mon', '00000000-0000-0000-0000-0000000002a3', 'abc.mon@exemplo.org'), -- monitor da região abc
  ('zl_mon',  '00000000-0000-0000-0000-0000000002a4', 'zl.mon@exemplo.org'),  -- monitor da região zl
  ('p1',      '00000000-0000-0000-0000-0000000002b1', 'p1@exemplo.org'),
  ('p2',      '00000000-0000-0000-0000-0000000002b2', 'p2@exemplo.org'),
  ('p3',      '00000000-0000-0000-0000-0000000002b3', 'p3@exemplo.org'),
  ('wl',      '00000000-0000-0000-0000-0000000002b4', 'wl@exemplo.org');      -- na espera
insert into auth.users (id, email) select id, email from people;
create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, state_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'SP', 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people where name <> 'wl');
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('wl');
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('nat'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('sp')),
  (pg_temp.person('abc_mon'), 'monitor', pg_temp.unit('abc')),
  (pg_temp.person('zl_mon'), 'monitor', pg_temp.unit('zl'));
-- Membro de verdade exige a casa aceita (ADR 0017).
insert into public.houses (key, active) select 'g-' || id::text, true from people on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at)
select id, 'g-' || id::text, 'self', now() - interval '2 days', now() - interval '1 day' from people where name <> 'wl' on conflict do nothing;

-- Privilégios: a API não grava direto
select ok(
  (select not has_table_privilege('authenticated', 'public.units', 'INSERT')
      and not has_table_privilege('authenticated', 'public.unit_members', 'INSERT')),
  'a API não insere direto em units nem unit_members'
);
select ok(not has_function_privilege('anon', 'public.create_team(uuid, text)', 'execute'), 'anon não cria equipe');
select ok(not has_function_privilege('anon', 'public.add_team_members(uuid, uuid[], integer)', 'execute'), 'anon não adiciona membros');

create temp table made (n int primary key, id uuid not null);
grant select, insert on made to authenticated;
set local role authenticated;

-- Criar equipe: dentro do escopo
select pg_temp.login('abc_mon');
insert into made select 1, public.create_team(pg_temp.unit('abc'), 'Equipe Ação');
insert into made select 2, public.create_team(pg_temp.unit('abc'), 'Equipe Ação');
insert into made select 3, public.create_team(pg_temp.unit('abc'), 'Outra equipe');
select is((select slug from public.units where id = (select id from made where n = 1)), 'equipe_acao', 'o rótulo perde acento e caracteres especiais');
select is((select slug from public.units where id = (select id from made where n = 2)), 'equipe_acao_2', 'colisão no mesmo pai ganha sufixo');
select is(
  (select t.is_team from public.units as u join public.unit_types as t on t.id = u.type_id where u.id = (select id from made where n = 1)),
  true, 'a equipe nasce como unidade do tipo team'
);
select throws_ok($$ select public.create_team(pg_temp.unit('zl'), 'Fora do escopo') $$, '42501', null, 'o monitor NÃO cria equipe em outra região');
select throws_ok($$ select public.create_team(pg_temp.unit('abc'), 'x') $$, '22023', null, 'nome curto demais é recusado');
select throws_ok($$ select public.create_team((select id from made where n = 1), 'Dentro de equipe') $$, '22023', null, 'equipe não fica dentro de equipe');
select throws_ok($$ select public.create_team(null, 'Sem pai') $$, '42501', null, 'pai nulo é recusado');

-- Adicionar: o gestor do estado põe quem está na unidade do estado
select pg_temp.login('sp_mgr');
select is(
  (select count(*)::int from public.add_team_members((select id from made where n = 1), array[pg_temp.person('p1'), pg_temp.person('p2')]) where added),
  2, 'o gestor do estado adiciona duas pessoas à equipe'
);
select is(
  (select m.unit_id from public.unit_members as m where m.profile_id = pg_temp.person('p1') and m.left_at is null),
  (select id from made where n = 1), 'o vínculo aberto da pessoa passa a ser o da equipe'
);
select is(
  (select count(*)::int from public.unit_members as m where m.profile_id = pg_temp.person('p1')), 2,
  'o vínculo anterior (do estado) foi encerrado, não apagado: histórico'
);
select is(
  (select count(*)::int from public.add_team_members((select id from made where n = 1), array[pg_temp.person('p1')]) where added),
  1, 'quem já está na equipe conta como adicionado, sem gravar de novo'
);
select is(
  (select count(*)::int from public.add_team_members((select id from made where n = 1), array[pg_temp.person('sp_mgr')]) where added),
  0, 'ninguém se adiciona a si mesmo'
);
select is(
  (select count(*)::int from public.add_team_members((select id from made where n = 1), array[pg_temp.person('wl'), '00000000-0000-0000-0000-00000000ffff']) where added),
  0, 'pessoa na espera e id inexistente são recusados'
);

-- Recusas por escopo
select pg_temp.login('abc_mon');
select is(
  (select count(*)::int from public.add_team_members((select id from made where n = 3), array[pg_temp.person('p3')]) where added),
  0, 'o monitor da região NÃO puxa quem está na unidade do estado (fora do escopo dele)'
);
select is(
  (select count(*)::int from public.add_team_members((select id from made where n = 3), array[pg_temp.person('p1')]) where added),
  1, 'o monitor move quem já está numa equipe da região dele para outra'
);
select is(
  (select m.unit_id from public.unit_members as m where m.profile_id = pg_temp.person('p1') and m.left_at is null),
  (select id from made where n = 3), 'mover encerra o vínculo da equipe anterior'
);
select pg_temp.login('zl_mon');
select throws_ok(
  $$ select * from public.add_team_members((select id from made where n = 3), array[pg_temp.person('p1')]) $$,
  '42501', null, 'o monitor de outra região NÃO mexe na equipe alheia'
);
select throws_ok($$ select * from public.add_team_members(pg_temp.unit('zl'), array[pg_temp.person('p1')]) $$, '22023', null, 'só equipe recebe membros (não uma região)');

-- Teto e limite de ids
select pg_temp.login('sp_mgr');
select is(
  (select count(*)::int from public.add_team_members((select id from made where n = 2), array[pg_temp.person('p3'), pg_temp.person('p2')], 1) where added),
  1, 'com teto de 1 membro, só um entra'
);
select throws_ok(
  $$ select * from public.add_team_members((select id from made where n = 2), (select array_agg(gen_random_uuid()) from generate_series(1, 201))) $$,
  '22023', null, 'mais de 200 ids é recusado'
);

-- Líder (#29)
select pg_temp.login('abc_mon');
select lives_ok($$ select public.set_team_lead((select id from made where n = 3), pg_temp.person('p1')) $$, 'o monitor define o líder da equipe');
select is(
  (select count(*)::int from public.unit_members as m where m.unit_id = (select id from made where n = 3) and m.left_at is null and m.member_role = 'lead'),
  1, 'um líder'
);
select throws_ok($$ select public.set_team_lead((select id from made where n = 3), pg_temp.person('p3')) $$, 'P0002', null, 'quem não está na equipe não vira líder');
select lives_ok($$ select public.set_team_lead((select id from made where n = 3), null) $$, 'tirar o líder (nulo) funciona');
select is(
  (select count(*)::int from public.unit_members as m where m.unit_id = (select id from made where n = 3) and m.left_at is null and m.member_role = 'lead'),
  0, 'ninguém fica como líder'
);
select pg_temp.login('zl_mon');
select throws_ok($$ select public.set_team_lead((select id from made where n = 3), pg_temp.person('p1')) $$, '42501', null, 'o monitor de outra região NÃO define líder');

-- Remover e arquivar
select throws_ok($$ select public.remove_team_member((select id from made where n = 3), pg_temp.person('p1')) $$, '42501', null, 'o monitor de outra região NÃO remove membro');
select pg_temp.login('abc_mon');
select throws_ok($$ select public.archive_team((select id from made where n = 3)) $$, '22023', null, 'equipe com membros não é arquivada');
select is(public.remove_team_member((select id from made where n = 3), pg_temp.person('p1')), true, 'o monitor remove o membro');
select is(public.remove_team_member((select id from made where n = 3), pg_temp.person('p1')), false, 'remover de novo devolve falso');
select pg_temp.login('sp_mgr');
select is(
  (select m.unit_id from public.unit_members as m where m.profile_id = pg_temp.person('p1') and m.left_at is null),
  pg_temp.unit('sp'), 'quem sai da equipe volta à unidade do estado'
);
select pg_temp.login('abc_mon');
select lives_ok($$ select public.archive_team((select id from made where n = 3)) $$, 'equipe vazia é arquivada');
select is((select status from public.units where id = (select id from made where n = 3)), 'archived', 'a equipe arquivada fica com status archived');
select throws_ok(
  $$ select * from public.add_team_members((select id from made where n = 3), array[pg_temp.person('p1')]) $$,
  '22023', null, 'equipe arquivada não recebe membros'
);

-- Sem sessão e anônimo
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.create_team(pg_temp.unit('abc'), 'Sem sessão') $$, '42501', null, 'sem sessão não cria equipe');
reset role;
set local role anon;
select throws_ok($$ select public.create_team('00000000-0000-0000-0000-000000000001'::uuid, 'Anônima') $$, '42501', null, 'o papel anon não executa create_team');

-- Auditoria: ator, alvo e as duas unidades, sem nome
reset role;
select is(
  (select count(*)::int from public.audit_log
   where event = 'member_moved' and actor_id = pg_temp.person('sp_mgr') and target_id = pg_temp.person('p1')
     and from_unit_id = pg_temp.unit('sp') and to_unit_id = (select id from made where n = 1)),
  1, 'member_moved guarda ator, alvo, unidade de origem e de destino'
);
select is(
  (select count(*)::int from public.audit_log where event = 'member_moved' and actor_id = pg_temp.person('abc_mon')),
  2, 'a mudança de equipe e a remoção também foram registradas'
);

select * from finish();
rollback;
