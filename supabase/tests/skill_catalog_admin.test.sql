-- Gestão do catálogo de habilidades pela coordenação nacional (#25): criar, renomear, mover, renomear grupo,
-- desativar e mesclar, todas só pela coordenação nacional e com auditoria. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select path::text, id from public.units where path::text in ('br', 'br.sp');
create function pg_temp.unit(p_path text) returns uuid language sql stable as $$ select id from unit_ids where slug = p_path $$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000f1', 'cat.root@exemplo.org'),
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000f2', 'cat.sp@exemplo.org'),
  ('p_a',      '00000000-0000-0000-0000-0000000000f3', 'cat.a@exemplo.org'),
  ('p_b',      '00000000-0000-0000-0000-0000000000f4', 'cat.b@exemplo.org');
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
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('br.sp'));
insert into public.houses (key, active) select 'c-' || id::text, true from people on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'c-' || id::text, 'self', now() from people on conflict do nothing;

-- Catálogo de teste: A e B (duplicadas), C (outra), D (inativa), em dois grupos.
create temp table sk (tag text primary key, id uuid not null);
grant select on sk to authenticated;
with ins as (
  insert into public.skills (name, category, aliases, active) values
    ('Cat Solda', 'Cat Grupo 1', array['soldagem'], true),
    ('Cat Soldagem', 'Cat Grupo 1', '{}', true),
    ('Cat Jardim', 'Cat Grupo 2', '{}', true),
    ('Cat Velha', 'Cat Grupo 2', '{}', false)
  returning id, name
)
insert into sk select case name when 'Cat Solda' then 'a' when 'Cat Soldagem' then 'b' when 'Cat Jardim' then 'c' else 'd' end, id from ins;
create function pg_temp.sk(p text) returns uuid language sql stable as $$ select id from sk where tag = p $$;
grant execute on function pg_temp.sk(text) to authenticated;

-- p_a tem A e C; p_b tem A e B (ao mesclar A em B, p_b só perde A).
insert into public.profile_skills (profile_id, skill_id) values
  (pg_temp.person('p_a'), pg_temp.sk('a')), (pg_temp.person('p_a'), pg_temp.sk('c')),
  (pg_temp.person('p_b'), pg_temp.sk('a')), (pg_temp.person('p_b'), pg_temp.sk('b'));

set local role authenticated;

-- Permissão: só a coordenação nacional.
select pg_temp.login('p_a');
select throws_ok($$ select public.create_skill('Cat Nova', 'Cat Grupo 1') $$, '42501', null, 'pessoa comum não cria');
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.rename_skill(pg_temp.sk('a'), 'Cat Outro') $$, '42501', null, 'gestor de estado não renomeia');
select throws_ok($$ select public.merge_skills(pg_temp.sk('a'), pg_temp.sk('b')) $$, '42501', null, 'gestor de estado não mescla');
select throws_ok($$ select public.rename_skill_group('Cat Grupo 1', 'Cat X') $$, '42501', null, 'gestor de estado não renomeia grupo');
select throws_ok($$ insert into public.skills (name, category) values ('Cat Direto', 'Cat Grupo 1') $$, '42501', null, 'e não há escrita direta em skills');
set local role anon;
select throws_ok($$ select public.set_skill_active(pg_temp.sk('a'), false) $$, '42501', null, 'anônimo não chama');
set local role authenticated;

-- Criar.
select pg_temp.login('root_mgr');
select ok(public.create_skill('  Cat Nova  ', 'Cat Grupo Novo') is not null, 'a coordenação nacional cria (e o nome é aparado)');
select is((select category from public.skills where name = 'Cat Nova'), 'Cat Grupo Novo', 'num grupo que ainda não existia');
select throws_ok($$ select public.create_skill('CAT   jardim', 'Cat Grupo 2') $$, 'C7704', null, 'nome igual a outro, sem caixa: C7704') ;
select throws_ok($$ select public.create_skill('Cat Velha', 'Cat Grupo 2') $$, 'C7704', null, 'nome de uma desativada também: reative em vez de criar');
select throws_ok($$ select public.create_skill('x', 'Cat Grupo 2') $$, '22023', null, 'nome curto demais');

-- Renomear.
select lives_ok($$ select public.rename_skill(pg_temp.sk('c'), 'Cat Jardinagem') $$, 'renomeia');
select is((select name from public.skills where id = pg_temp.sk('c')), 'Cat Jardinagem', 'o nome mudou');
select ok((select aliases @> array['cat jardim'] from public.skills where id = pg_temp.sk('c')), 'o nome antigo virou sinônimo');
select is((select count(*)::int from public.profile_skills where skill_id = pg_temp.sk('c')), 1, 'quem tinha a habilidade continua com ela');
select throws_ok($$ select public.rename_skill(pg_temp.sk('c'), 'cat soldagem') $$, 'C7704', null, 'renomear para nome de outra: C7704');

-- Mover e renomear grupo (operações separadas).
select lives_ok($$ select public.move_skill(pg_temp.sk('c'), 'Cat Grupo 1') $$, 'move uma habilidade de grupo');
select is((select category from public.skills where id = pg_temp.sk('c')), 'Cat Grupo 1', 'e só ela mudou de grupo');
select is(public.rename_skill_group('Cat Grupo 2', 'Cat Grupo Dois'), 1, 'renomear o grupo muda as habilidades dele (a que sobrou)');
select is((select category from public.skills where id = pg_temp.sk('d')), 'Cat Grupo Dois', 'inclusive a desativada');
select throws_ok($$ select public.rename_skill_group('Cat Nao Existe', 'Cat Y') $$, 'P0002', null, 'grupo inexistente');

-- Desativar e reativar: quem tem mantém.
select lives_ok($$ select public.set_skill_active(pg_temp.sk('b'), false) $$, 'desativa');
select is((select count(*)::int from public.profile_skills where skill_id = pg_temp.sk('b')), 1, 'quem a tinha continua com ela');
select lives_ok($$ select public.set_skill_active(pg_temp.sk('b'), true) $$, 'reativa');

-- Mesclar A em B.
select throws_ok($$ select public.merge_skills(pg_temp.sk('a'), pg_temp.sk('a')) $$, 'C7705', null, 'não mescla nela mesma');
select throws_ok($$ select public.merge_skills(pg_temp.sk('a'), pg_temp.sk('d')) $$, 'C7705', null, 'o destino precisa estar ativo');
select is(public.merge_skills(pg_temp.sk('a'), pg_temp.sk('b')), 1, 'mescla; só uma pessoa (p_a) passou a ter B, p_b já tinha');
select results_eq(
  $$ select profile_id from public.profile_skills where skill_id = pg_temp.sk('b') order by profile_id $$,
  $$ select id from people where name in ('p_a', 'p_b') order by id $$,
  'p_a e p_b têm B, sem duplicar'
);
select is((select count(*)::int from public.profile_skills where skill_id = pg_temp.sk('a')), 0, 'ninguém ficou com A');
select ok(
  (select not active and true from public.skills where id = pg_temp.sk('a'))
  and (select aliases @> array['cat solda', 'soldagem'] from public.skills where id = pg_temp.sk('b')),
  'A fica desativada e o nome e os sinônimos dela passam para B'
);

-- Auditoria: cada mudança deixou o seu evento, só com o ator.
reset role;
select ok(
  (select count(distinct event) from public.audit_log
    where actor_id = pg_temp.person('root_mgr')
      and event in ('skill_created', 'skill_renamed', 'skill_moved', 'skill_group_renamed', 'skill_deactivated', 'skill_reactivated', 'skill_merged')) = 7
  and not exists (select 1 from public.audit_log where event like 'skill\_%' and target_id is not null),
  'criar, renomear, mover, renomear grupo, desativar, reativar e mesclar ficam no audit_log, sem alvo'
);

select * from finish();
rollback;
