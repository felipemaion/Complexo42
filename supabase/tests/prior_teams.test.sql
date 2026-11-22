-- Equipes de antes da plataforma (#136, autodeclaradas): até 5 equipes por pessoa. A própria
-- pessoa adiciona e tira; vê ela mesma ou a coordenação com escopo. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select ok((select relrowsecurity from pg_class where oid = 'public.prior_teams'::regclass), 'prior_teams tem RLS ligada');

truncate public.role_assignments, public.unit_members, public.house_members, public.units cascade;
create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns void language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, (select u.id from public.units as u where u.slug = p_parent), p_slug, p_slug,
         p_state, p_slug::extensions.ltree
  from public.unit_types as t where t.key = p_type
$$;
select pg_temp.add_unit('national', null, 'br');
select pg_temp.add_unit('state', 'br', 'sp', 'SP');
select pg_temp.add_unit('region', 'sp', 'abc');
select pg_temp.add_unit('team', 'abc', 'team_x');
select pg_temp.add_unit('region', 'sp', 'zl');

-- a1 dona das equipes | c1 coordenação ABC (escopo) | f1 membro de outra região (fora)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000f1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'manager', id from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('team_x', '00000000-0000-0000-0000-0000000000a1'::uuid), ('abc', '00000000-0000-0000-0000-0000000000c1'),
  ('zl', '00000000-0000-0000-0000-0000000000f1')
) as v (slug, p) join public.units as u on u.slug = v.slug;

-- 7) anon não executa as funções nem lê a tabela
set local role anon;
select throws_ok($$ select public.add_prior_team('Equipe Antiga', '2023', 'member') $$,
  '42501', null, 'anon não executa add_prior_team');
select throws_ok($$ select public.remove_prior_team('00000000-0000-0000-0000-000000000001'::uuid) $$,
  '42501', null, 'anon não executa remove_prior_team');
select throws_ok($$ select * from public.prior_teams_list('00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'anon não executa prior_teams_list');
select throws_ok($$ select * from public.prior_teams $$,
  '42501', null, 'anon não lê a tabela prior_teams');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

-- 2) texto curto/longo e papel desconhecido -> 22023
select throws_ok($$ select public.add_prior_team('A', '2023', 'member') $$,
  '22023', null, 'nome de equipe com menos de 2 letras é recusado');
select throws_ok($$ select public.add_prior_team(repeat('a', 81), '2023', 'member') $$,
  '22023', null, 'nome de equipe com mais de 80 letras é recusado');
select throws_ok($$ select public.add_prior_team('Equipe Alpha', '', 'member') $$,
  '22023', null, 'período vazio é recusado');
select throws_ok($$ select public.add_prior_team('Equipe Alpha', repeat('a', 41), 'member') $$,
  '22023', null, 'período com mais de 40 letras é recusado');
select throws_ok($$ select public.add_prior_team('Equipe Alpha', '2023', 'lider') $$,
  '22023', null, 'papel desconhecido é recusado');

-- 1) membro ativo adiciona 1 equipe e lê a própria lista
select lives_ok($$ select public.add_prior_team('Equipe Alpha', '2021', 'member') $$,
  'membro ativo adiciona 1 equipe');
select is((select count(*)::int from public.prior_teams_list('00000000-0000-0000-0000-0000000000a1')), 1,
  'membro ativo lê a própria lista');

select throws_ok($$ insert into public.prior_teams (profile_id, team_name, period, role, position)
  values ('00000000-0000-0000-0000-0000000000a1', 'Equipe Beta', '2022', 'member', 2) $$,
  '42501', null, 'ninguém grava direto na tabela (só pela função)');

select public.add_prior_team('Equipe Beta', '2022', 'spokesperson');
select public.add_prior_team('Equipe Gama', '2023', 'coordinator');
select public.add_prior_team('Equipe Delta', 'ciclo 2024/1', 'member');
select public.add_prior_team('Equipe Epsilon', 'ciclo 2024/2', 'member');

-- 3) sexta equipe -> 22023
select throws_ok($$ select public.add_prior_team('Equipe Zeta', '2025', 'member') $$,
  '22023', null, 'sexta equipe é recusada (até 5)');

-- Guarda o id real da 1ª equipe (a dona enxerga) para a outra pessoa tentar tirar ESSA linha.
select set_config('test.item1', (select id::text from public.prior_teams where position = 1), true);

-- 5) outra pessoa comum (sem papel) NÃO vê a lista (0 linhas) e não remove (42501)
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.prior_teams_list('00000000-0000-0000-0000-0000000000a1')), 0,
  'outra pessoa comum não vê a lista (0 linhas)');
select throws_ok($$ select public.remove_prior_team(current_setting('test.item1')::uuid) $$,
  '42501', null, 'outra pessoa não remove equipe alheia');

-- 6) coordenação com escopo sobre a unidade da pessoa vê a lista
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is((select string_agg(team_name, ',' order by position) from public.prior_teams_list('00000000-0000-0000-0000-0000000000a1')),
  'Equipe Alpha,Equipe Beta,Equipe Gama,Equipe Delta,Equipe Epsilon',
  'coordenação com escopo sobre a unidade da pessoa vê a lista');

-- 4) remover reordena as posições
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.remove_prior_team((select id from public.prior_teams where profile_id = '00000000-0000-0000-0000-0000000000a1' and position = 2));
select is((select string_agg(team_name || ':' || position, ',' order by position) from public.prior_teams_list('00000000-0000-0000-0000-0000000000a1')),
  'Equipe Alpha:1,Equipe Gama:2,Equipe Delta:3,Equipe Epsilon:4',
  'ao remover uma equipe, as posições são reordenadas sem buracos');

-- "Baixar meus dados" leva as equipes de antes da plataforma.
select is((select jsonb_array_length(public.export_own_activity() -> 'prior_teams')), 4,
  'Baixar meus dados leva as equipes de antes da plataforma');

-- Linhas guardadas fora de ordem (o banco reaproveita espaço): tirar a 1ª ainda reordena, sem
-- "chave repetida" no meio da conta. A leitura sequencial é forçada para não depender do plano.
reset role;
insert into public.prior_teams (profile_id, team_name, period, role, position) values
  ('00000000-0000-0000-0000-0000000000f1', 'Equipe Um', '2020', 'member', 1),
  ('00000000-0000-0000-0000-0000000000f1', 'Equipe Tres', '2020', 'member', 3),
  ('00000000-0000-0000-0000-0000000000f1', 'Equipe Dois', '2020', 'member', 2);
set local enable_indexscan = off;
set local enable_bitmapscan = off;
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select public.remove_prior_team((select id from public.prior_teams where team_name = 'Equipe Um')) $$,
  'tirar a 1ª equipe funciona com as linhas guardadas fora de ordem');
select is((select string_agg(team_name || ':' || position, ',' order by position) from public.prior_teams_list('00000000-0000-0000-0000-0000000000f1')),
  'Equipe Dois:1,Equipe Tres:2', 'e as outras sobem sem buraco');

-- 8) apagar a pessoa em auth.users apaga as linhas (cascade)
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.prior_teams where profile_id = '00000000-0000-0000-0000-0000000000a1'), 0,
  'apagar a pessoa em auth.users apaga as linhas (cascade)');

select * from finish();
rollback;
