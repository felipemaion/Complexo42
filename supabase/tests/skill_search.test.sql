-- Busca de pessoas por habilidade (issue #23): `search_people_by_skills`. Roda no banco (habilidades indexadas),
-- respeita o escopo (`can_view_profile`; a nacional vê todos), combina habilidades com E ou OU, filtra por UF,
-- município e turma, pagina por cursor, limita a 60 buscas por hora e audita cada busca. Não devolve contato.
-- O desempenho (50 mil perfis) fica em scripts/skill-search-benchmark.sql, fora do pgTAP. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select path::text, id from public.units where path::text in ('br', 'br.sp', 'br.mg');
create function pg_temp.unit(p_path text) returns uuid language sql stable as $$ select id from unit_ids where slug = p_path $$;

create temp table people (name text primary key, id uuid not null unique, email text not null, mun int not null);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000f1', 'root.mgr@exemplo.org', 3550308), -- coordenação nacional
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000f2', 'sp.mgr@exemplo.org',   3550308), -- gestor de SP
  ('plain',    '00000000-0000-0000-0000-0000000000f3', 'plain@exemplo.org',    3550308), -- sem papel
  ('sp1',      '00000000-0000-0000-0000-0000000000f4', 'sp1@exemplo.org',      3550308), -- SP, na turma S
  ('sp2',      '00000000-0000-0000-0000-0000000000f5', 'sp2@exemplo.org',      3550308), -- SP, sem turma
  ('mg1',      '00000000-0000-0000-0000-0000000000f6', 'mg1@exemplo.org',      3106200), -- MG
  ('sp_susp',  '00000000-0000-0000-0000-0000000000f7', 'sp.susp@exemplo.org',  3550308), -- SP, suspensa
  ('p_wait',   '00000000-0000-0000-0000-0000000000f8', 'p.wait@exemplo.org',   3550308); -- na espera
insert into auth.users (id, email) select id, email from people;

create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people, unit_ids to authenticated;

insert into public.municipalities (code, name, state_code) values (3106200, 'Belo Horizonte', 'MG') on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', mun, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people) and id <> pg_temp.person('p_wait');
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('p_wait');
update public.profiles set status = 'suspended' where id = pg_temp.person('sp_susp');

insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('br.sp'));
-- Membro de verdade exige a casa aceita (ADR 0017).
insert into public.houses (key, active) select 'g-' || id::text, true from people on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'g-' || id::text, 'self', now() from people where name <> 'p_wait' on conflict do nothing;

-- Uma turma (equipe) em SP; sp1 está nela, sp2 só no estado.
insert into public.units (type_id, parent_id, slug, name, state_code, path)
select t.id, (select u.id from public.units as u where u.path = 'br.sp'::extensions.ltree), 'team_s', 'Turma teste S', 'SP', 'br.sp.team_s'::extensions.ltree
from public.unit_types as t where t.key = 'team';
create temp table team_ids (id uuid not null);
insert into team_ids select id from public.units where slug = 'team_s';
update public.unit_members set left_at = now() where profile_id = pg_temp.person('sp1') and left_at is null;
insert into public.unit_members (unit_id, profile_id) select id, pg_temp.person('sp1') from team_ids;

-- Habilidades e quem as tem: sp1 = s1,s2,s3; sp2 = s1; mg1 = s1,s2; sp_susp = s1.
create temp table sk (n int primary key, id uuid not null);
with ins as (
  insert into public.skills (name, category) select 'Busca teste ' || g, 'Grupo busca' from generate_series(1, 3) as g returning id, name
)
insert into sk select (regexp_replace(name, '\D', '', 'g'))::int, id from ins;
grant select on sk to authenticated;
create function pg_temp.sk(p int) returns uuid language sql stable as $$ select id from sk where n = p $$;
insert into public.profile_skills (profile_id, skill_id) values
  (pg_temp.person('sp1'), pg_temp.sk(1)), (pg_temp.person('sp1'), pg_temp.sk(2)), (pg_temp.person('sp1'), pg_temp.sk(3)),
  (pg_temp.person('sp2'), pg_temp.sk(1)),
  (pg_temp.person('mg1'), pg_temp.sk(1)), (pg_temp.person('mg1'), pg_temp.sk(2)),
  (pg_temp.person('sp_susp'), pg_temp.sk(1));

create function pg_temp.search(
  p_login text, p_ids uuid[], p_mode text default 'all', p_state text default null, p_mun integer default null,
  p_unit uuid default null, p_no_team boolean default false, p_limit integer default 20,
  p_ac integer default null, p_ai uuid default null
) returns table (profile_id uuid, common_count integer, skill_ids uuid[])
language plpgsql as $$
begin
  perform pg_temp.login(p_login);
  return query
    select r.profile_id, r.common_count, r.skill_ids
    from public.search_people_by_skills(p_ids, p_mode, p_state, p_mun, null, p_unit, p_no_team, p_limit, p_ac, p_ai) as r;
end;
$$;

create function pg_temp.ids(variadic p_names text[]) returns uuid[] language sql stable as $$
  select array_agg(pg_temp.person(n)) from unnest(p_names) as n
$$;

-- ---------------------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.search_people_by_skills(uuid[], text, text, integer, integer, uuid, boolean, integer, integer, uuid)', 'execute'),
  'anônimo não busca'
);
select has_index('public', 'profile_skills', 'profile_skills_skill_id_idx', array['skill_id', 'profile_id'], 'índice (skill_id, profile_id): a busca por habilidade roda no índice');
select has_index('public', 'audit_log', 'audit_log_actor_event_created_idx', array['actor_id', 'event', 'created_at'], 'índice do limite de buscas por hora');
select has_index('public', 'profiles', 'profiles_active_location_idx', array['state_code', 'municipality_code'], 'índice de UF e município dos perfis ativos');
select ok(
  pg_get_function_result('public.search_people_by_skills(uuid[], text, text, integer, integer, uuid, boolean, integer, integer, uuid)'::regprocedure) not ilike '%whatsapp%'
  and pg_get_function_result('public.search_people_by_skills(uuid[], text, text, integer, integer, uuid, boolean, integer, integer, uuid)'::regprocedure) not ilike '%contact%'
  and pg_get_function_result('public.search_people_by_skills(uuid[], text, text, integer, integer, uuid, boolean, integer, integer, uuid)'::regprocedure) ilike '%display_name_enc%',
  'a lista devolve o nome cifrado e nenhum contato (o contato é da #48, auditado)'
);

-- ---------------------------------------------------------------------------------------
-- Escopo
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select set_eq(
  $$ select profile_id from pg_temp.search('root_mgr', array[pg_temp.sk(1), pg_temp.sk(2)], 'all') $$,
  $$ select unnest(pg_temp.ids('sp1', 'mg1')) $$,
  'a nacional vê todos: E (todas as habilidades) acha sp1 e mg1'
);
select set_eq(
  $$ select profile_id from pg_temp.search('root_mgr', array[pg_temp.sk(1), pg_temp.sk(2)], 'any') $$,
  $$ select unnest(pg_temp.ids('sp1', 'sp2', 'mg1')) $$,
  'OU (qualquer uma) acha também sp2; a pessoa suspensa nunca aparece'
);
select is(
  (select max(common_count) from pg_temp.search('root_mgr', array[pg_temp.sk(1), pg_temp.sk(2)], 'any')), 2,
  'a quantidade de habilidades em comum vem na linha'
);
select set_eq(
  $$ select profile_id from pg_temp.search('sp_mgr', array[pg_temp.sk(1), pg_temp.sk(2)], 'all') $$,
  $$ select unnest(pg_temp.ids('sp1')) $$,
  'o gestor de SP não encontra quem é de MG, mesmo com as habilidades buscadas'
);
select set_eq(
  $$ select profile_id from pg_temp.search('sp_mgr', array[pg_temp.sk(1)], 'any') $$,
  $$ select unnest(pg_temp.ids('sp1', 'sp2')) $$,
  'e acha quem é do escopo dele'
);
select is((select count(*)::int from pg_temp.search('plain', array[pg_temp.sk(1)], 'any')), 0,
  'quem não tem escopo sobre ninguém recebe lista vazia, não erro');
select is((select count(*)::int from pg_temp.search('p_wait', array[pg_temp.sk(1)], 'any')), 0,
  'quem não está liberado recebe lista vazia');
set local role anon;
select throws_ok(
  $$ select * from public.search_people_by_skills(array['00000000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', null, 'anônimo recebe recusa'
);
set local role authenticated;

-- ---------------------------------------------------------------------------------------
-- Filtros
-- ---------------------------------------------------------------------------------------
select set_eq(
  $$ select profile_id from pg_temp.search('root_mgr', array[pg_temp.sk(1)], 'any', 'MG') $$,
  $$ select unnest(pg_temp.ids('mg1')) $$,
  'filtro de UF'
);
select set_eq(
  $$ select profile_id from pg_temp.search('root_mgr', array[pg_temp.sk(1)], 'any', null, 3550308) $$,
  $$ select unnest(pg_temp.ids('sp1', 'sp2')) $$,
  'filtro de município'
);
select set_eq(
  $$ select profile_id from pg_temp.search('root_mgr', array[pg_temp.sk(1)], 'any', null, null, (select id from team_ids)) $$,
  $$ select unnest(pg_temp.ids('sp1')) $$,
  'filtro de turma'
);
select set_eq(
  $$ select profile_id from pg_temp.search('root_mgr', array[pg_temp.sk(1)], 'any', null, null, null, true) $$,
  $$ select unnest(pg_temp.ids('sp2', 'mg1')) $$,
  '"sem turma" tira quem está numa turma'
);

-- ---------------------------------------------------------------------------------------
-- Entrada inválida
-- ---------------------------------------------------------------------------------------
select throws_ok($$ select * from pg_temp.search('root_mgr', '{}'::uuid[]) $$, '22023', null, 'sem habilidade: recusa');
select throws_ok(
  $$ select * from pg_temp.search('root_mgr', array[pg_temp.sk(1), pg_temp.sk(1), pg_temp.sk(2), pg_temp.sk(3), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]) $$,
  '22023', null, 'mais de 5 habilidades: recusa'
);
select throws_ok($$ select * from pg_temp.search('root_mgr', array[pg_temp.sk(1)], 'talvez') $$, '22023', null, 'modo fora da lista: recusa');

-- ---------------------------------------------------------------------------------------
-- Lista: todas as habilidades da pessoa e paginação por cursor
-- ---------------------------------------------------------------------------------------
select is(
  (select cardinality(skill_ids) from pg_temp.search('root_mgr', array[pg_temp.sk(1)], 'any') where profile_id = pg_temp.person('sp1')), 3,
  'a linha traz todas as habilidades da pessoa (as buscadas ficam em destaque na tela)'
);
select is(
  (select count(*)::int from pg_temp.search('root_mgr', array[pg_temp.sk(1), pg_temp.sk(2)], 'any', null, null, null, false, 2)), 3,
  'pede-se limite + 1 linha: a sobra diz que há mais páginas'
);
select is(
  (select profile_id from pg_temp.search('root_mgr', array[pg_temp.sk(1), pg_temp.sk(2)], 'any', null, null, null, false, 20, 2, pg_temp.person('sp1'))
   order by common_count desc, profile_id limit 1),
  pg_temp.person('mg1'),
  'o cursor (em comum, id) continua depois do último da página anterior'
);

-- ---------------------------------------------------------------------------------------
-- Auditoria e limite por hora
-- ---------------------------------------------------------------------------------------
reset role;
create temp table audit_before (c int);
insert into audit_before select count(*)::int from public.audit_log where event = 'skills_searched' and actor_id = pg_temp.person('root_mgr');
set local role authenticated;
select count(*) from pg_temp.search('root_mgr', array[pg_temp.sk(1)], 'any');
reset role;
select is(
  (select count(*)::int from public.audit_log where event = 'skills_searched' and actor_id = pg_temp.person('root_mgr')) - (select c from audit_before),
  1, 'cada busca grava skills_searched (só o ator; nem o termo nem as habilidades)'
);
insert into public.audit_log (actor_id, event) select pg_temp.person('plain'), 'skills_searched' from generate_series(1, 60);
set local role authenticated;
select throws_ok($$ select * from pg_temp.search('plain', array[pg_temp.sk(1)], 'any') $$, '54000', null,
  'a 61ª busca na mesma hora é recusada');

select * from finish();
rollback;
