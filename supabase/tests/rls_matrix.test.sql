-- Matriz de RLS gerada (#154, ADR 0002, R5, R16). Em vez de caso a caso, o teste lê o catálogo do
-- banco (pg_class, pg_policies, privilégios) e compara com UMA declaração por tabela:
--   leitura: none (ninguém lê direto) | own (só a própria linha) | scope (função de escopo app.*)
--            | catalog (todo membro ativo lê, sem dado pessoal)
--   escrita direta: none (só por função security definer) | policy (privilégio + política com condição)
-- Tabela nova sem linha aqui faz o teste falhar (falha fechado); linha de tabela que não existe também.
-- Depois, aluno, líder e coordenador (dentro do ABC) varrem TODA tabela com coluna de pessoa e não
-- podem ver nenhuma linha de alguém de fora do escopo (R16). Pessoas fictícias, só nesta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create temp table expected (
  table_name text primary key,
  read_rule text not null check (read_rule in ('none', 'own', 'scope', 'catalog')),
  direct_write text not null check (direct_write in ('none', 'policy'))
);
insert into expected values
  ('access_allowlist', 'none', 'none'),
  ('access_waitlist_hmac', 'none', 'none'),
  ('audit_log', 'scope', 'none'),
  ('badges', 'catalog', 'none'),
  ('consent_acceptances', 'own', 'none'),
  ('contact_visibility', 'own', 'none'),
  ('districts', 'catalog', 'none'),
  ('draft_sessions', 'scope', 'none'),
  ('evaluation_access_requests', 'own', 'none'),
  ('house_analysis_requests', 'scope', 'none'),
  ('house_members', 'scope', 'policy'),
  ('houses', 'catalog', 'none'),
  ('member_evaluations', 'own', 'none'),
  ('mission_run_members', 'scope', 'none'),
  ('mission_runs', 'scope', 'none'),
  ('mission_steps', 'scope', 'policy'),
  ('missions', 'scope', 'policy'),
  ('municipalities', 'catalog', 'none'),
  ('points_ledger', 'scope', 'none'),
  ('portfolio_items', 'own', 'none'),
  ('prior_teams', 'own', 'none'),
  ('profile_badges', 'scope', 'none'),
  ('profile_contacts', 'own', 'none'),
  ('profile_skills', 'scope', 'none'),
  ('profiles', 'scope', 'none'),
  ('questionnaire_consents', 'own', 'none'),
  ('questionnaire_data_grants', 'scope', 'none'),
  ('questionnaire_results', 'scope', 'none'),
  ('role_assignments', 'scope', 'policy'),
  ('skills', 'catalog', 'none'),
  ('step_submissions', 'scope', 'none'),
  ('team_messages', 'scope', 'none'),
  ('unit_members', 'scope', 'policy'),
  ('unit_types', 'catalog', 'none'),
  ('units', 'scope', 'policy');

create temp view actual as
select c.relname::text as table_name, c.oid
from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p');

-- Políticas de leitura que valem para quem entrou (papel authenticated ou public).
create temp view read_policies as
select p.tablename::text as table_name, regexp_replace(coalesce(p.qual, ''), '\s+', ' ', 'g') as qual
from pg_policies as p
where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL')
  and ('authenticated' = any (p.roles) or 'public' = any (p.roles));

-- 1) Falha fechado: toda tabela tem declaração e toda declaração tem tabela.
select set_eq($$ select table_name from actual $$, $$ select table_name from expected $$,
  'toda tabela de public tem uma linha na matriz (e nenhuma linha sobra)');

-- 2) Quem não entrou (anon) não tem privilégio em nenhuma tabela.
select is_empty($$
  select a.table_name from actual as a
  where has_table_privilege('anon', a.oid, 'select') or has_any_column_privilege('anon', a.oid, 'insert')
     or has_any_column_privilege('anon', a.oid, 'update') or has_table_privilege('anon', a.oid, 'delete')
$$, 'anon não tem privilégio em nenhuma tabela');

-- 3) Escrita direta só onde a matriz diz; no resto, só por função.
select is_empty($$
  select a.table_name from actual as a join expected as e using (table_name)
  where (e.direct_write = 'none') = (has_any_column_privilege('authenticated', a.oid, 'insert')
     or has_any_column_privilege('authenticated', a.oid, 'update') or has_table_privilege('authenticated', a.oid, 'delete'))
$$, 'privilégio de escrita direta bate com a matriz');

-- 4) Onde há escrita direta, toda política de escrita tem condição de verdade (nunca "true").
select is_empty($$
  select p.tablename from pg_policies as p join expected as e on e.table_name = p.tablename
  where p.schemaname = 'public' and e.direct_write = 'policy' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (coalesce(p.qual, p.with_check) is null or coalesce(p.qual, p.with_check) ~* '^\s*true\s*$'
         or coalesce(p.qual, p.with_check) !~ '(app\.|auth\.uid)')
$$, 'política de escrita sempre confere quem (função de escopo ou auth.uid())');

-- 5) Leitura "none": sem privilégio de leitura ou só política "false".
select is_empty($$
  select a.table_name from actual as a join expected as e using (table_name)
  where e.read_rule = 'none' and has_table_privilege('authenticated', a.oid, 'select')
    and exists (select 1 from read_policies as r where r.table_name = a.table_name and r.qual !~* '^\s*false\s*$')
$$, 'tabela sem leitura não tem política que abra linha');

-- 6) Leitura "own": toda política de leitura amarra a linha a auth.uid() e não abre por escopo.
select is_empty($$
  select e.table_name from expected as e
  where e.read_rule = 'own' and (
    not exists (select 1 from read_policies as r where r.table_name = e.table_name)
    or exists (select 1 from read_policies as r where r.table_name = e.table_name
               and (r.qual !~ 'auth\.uid\(\)'
                    or r.qual ~ 'app\.(can_|has_scope|manages|profiles_in_my_scope|units_i_coordinate|coordinates_any_house)'))
  )
$$, 'leitura "own": só a própria linha');

-- 7) Leitura "scope": toda política de leitura passa por uma função de escopo (app.*), nunca "true".
select is_empty($$
  select e.table_name from expected as e
  where e.read_rule = 'scope' and (
    not exists (select 1 from read_policies as r where r.table_name = e.table_name)
    or exists (select 1 from read_policies as r where r.table_name = e.table_name
               and (r.qual !~ 'app\.' or r.qual ~* '^\s*true\s*$'))
  )
$$, 'leitura "scope": sempre por função de escopo');

-- 8) Leitura "catalog": só a porta de membro ativo, sem condição por linha.
select is_empty($$
  select e.table_name from expected as e
  where e.read_rule = 'catalog' and (
    not exists (select 1 from read_policies as r where r.table_name = e.table_name)
    or exists (select 1 from read_policies as r where r.table_name = e.table_name
               and r.qual !~ '^app\.(is_active_member|can_read_municipalities)\(\)$')
  )
$$, 'leitura "catalog": todo membro ativo, nada mais');

-- ---------------------------------------------------------------------------------------------
-- Varredura por papel (R16): aluno, líder e coordenador do ABC contra uma pessoa de Minas.
--   br ─┬─ sp ── abc ── team_a      (a1 aluno, b1 líder/porta-voz, c1 coordenador do ABC)
--       └─ mg ── central ── team_m  (d1, fora do escopo dos três)
-- ---------------------------------------------------------------------------------------------
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
select pg_temp.add_unit('state', 'br', 'mg', 'MG');
select pg_temp.add_unit('region', 'sp', 'abc');
select pg_temp.add_unit('region', 'mg', 'central');
select pg_temp.add_unit('team', 'abc', 'team_a');
select pg_temp.add_unit('team', 'central', 'team_m');

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000d1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000_1';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000_1';
-- a1 aluno, b1 líder (porta-voz) da team_a, c1 coordenador do ABC, d1 de fora (team_m, MG).
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('team_a', '00000000-0000-0000-0000-0000000000a1'::uuid), ('team_a', '00000000-0000-0000-0000-0000000000b1'),
  ('abc', '00000000-0000-0000-0000-0000000000c1'), ('team_m', '00000000-0000-0000-0000-0000000000d1')
) as v (slug, p) join public.units as u on u.slug = v.slug;
insert into public.role_assignments (profile_id, role, unit_id)
select v.p, v.role, u.id from (values
  ('00000000-0000-0000-0000-0000000000b1'::uuid, 'spokesperson', 'team_a'),
  ('00000000-0000-0000-0000-0000000000c1', 'manager', 'abc'),
  ('00000000-0000-0000-0000-0000000000d1', 'spokesperson', 'team_m')
) as v (p, role, slug) join public.units as u on u.slug = v.slug;

-- Linhas da pessoa de fora (d1) espalhadas pelas tabelas com dado de pessoa.
insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
values ('00000000-0000-0000-0000-0000000000d1', pg_temp.enc('w'), repeat('a', 64));
insert into public.consent_acceptances (user_id, version) values ('00000000-0000-0000-0000-0000000000d1', 'v1');
insert into public.questionnaire_consents (profile_id, term_version)
select '00000000-0000-0000-0000-0000000000d1', version from app.questionnaire_term_versions limit 1;
insert into public.contact_visibility (profile_id, kind) values ('00000000-0000-0000-0000-0000000000d1', 'whatsapp');
insert into public.portfolio_items (profile_id, url_enc, kind, title, position)
values ('00000000-0000-0000-0000-0000000000d1', pg_temp.enc('u'), 'video', 'Trabalho', 1);
insert into public.prior_teams (profile_id, team_name, period, role, position)
values ('00000000-0000-0000-0000-0000000000d1', 'Equipe Antiga', '2023', 'member', 1);
insert into public.skills (name, category) values ('Teste Matriz', 'Teste');
insert into public.profile_skills (profile_id, skill_id)
select '00000000-0000-0000-0000-0000000000d1', id from public.skills where name = 'Teste Matriz';

-- Colunas de pessoa de cada tabela "own"/"scope", lidas aqui como dono do banco (o papel
-- authenticated não enxerga o catálogo inteiro).
create temp table person_columns as
select c.table_name::text, c.column_name::text
from information_schema.columns as c join expected as e on e.table_name = c.table_name
where c.table_schema = 'public' and e.read_rule in ('own', 'scope') and c.data_type = 'uuid'
  and c.column_name in ('profile_id', 'user_id', 'author_id', 'submitted_by', 'evaluator_id', 'requester_id', 'actor_id', 'target_id')
union all select 'profiles', 'id';
grant select on person_columns to authenticated;

-- 9) A varredura não é vazia: a pessoa de fora tem linhas em pelo menos 9 tabelas.
create function pg_temp.tables_with(p_person uuid) returns integer language plpgsql as $$
declare
  r record;
  n integer;
  total integer := 0;
begin
  for r in select distinct table_name, column_name from person_columns loop
    execute format('select count(*) from public.%I where %I = %L', r.table_name, r.column_name, p_person) into n;
    if n > 0 then total := total + 1; end if;
  end loop;
  return total;
end;
$$;
select cmp_ok(pg_temp.tables_with('00000000-0000-0000-0000-0000000000d1'), '>=', 9,
  'a pessoa de fora tem dado em várias tabelas (a varredura testa algo)');

-- 10) Aluno, líder e coordenador do ABC: zero linhas da pessoa de fora em qualquer tabela; e o
-- coordenador enxerga o aluno (prova de que o papel funciona e não é tudo negado).
create function pg_temp.leaks(p_viewer uuid) returns setof text language plpgsql as $$
declare
  r record;
  n integer;
begin
  perform pg_temp.login(p_viewer);
  for r in select distinct table_name, column_name from person_columns loop
    execute format('select count(*) from public.%I where %I = %L', r.table_name, r.column_name,
      '00000000-0000-0000-0000-0000000000d1') into n;
    if n > 0 then
      return next format('%s vê %s linha(s) de fora em %s.%s', p_viewer, n, r.table_name, r.column_name);
    end if;
  end loop;
end;
$$;
create function pg_temp.sees(p_viewer uuid, p_target uuid) returns boolean language plpgsql as $$
begin
  perform pg_temp.login(p_viewer);
  return exists (select 1 from public.profiles where id = p_target);
end;
$$;
set local role authenticated;
select is_empty($$
  select pg_temp.leaks('00000000-0000-0000-0000-0000000000a1')
  union all select pg_temp.leaks('00000000-0000-0000-0000-0000000000b1')
  union all select pg_temp.leaks('00000000-0000-0000-0000-0000000000c1')
  union all select 'o coordenador não vê o aluno do próprio escopo'
    where not pg_temp.sees('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1')
$$, 'aluno, líder e coordenador não veem nada de quem está fora do escopo (e o coordenador vê o aluno)');

select * from finish();
rollback;
