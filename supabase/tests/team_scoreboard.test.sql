-- Placar de equipes por escopo e período (#58, ADR 0006 §6): soma os pontos de cada equipe (linhas
-- da unidade no livro-razão, nunca de pessoas) no período pedido. Vê quem está no escopo ou o
-- coordena. Sem ranking de pessoas. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

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
select pg_temp.add_unit('team', 'abc', 'team_y');
select pg_temp.add_unit('region', 'sp', 'zl');
select pg_temp.add_unit('team', 'zl', 'team_z');

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000f1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values ('team_x', '00000000-0000-0000-0000-0000000000a1'::uuid), ('team_z', '00000000-0000-0000-0000-0000000000f1'))
  as v (slug, p) join public.units as u on u.slug = v.slug;

-- Pontos: X 30 (20 recentes + 10 antigos), Y 50 recentes, Z 99 (outra região); pessoa de X com 70 (não conta).
insert into public.points_ledger (unit_id, profile_id, points, reason, created_at)
select u.id, null, v.pts, 'etapa aprovada', now() - v.ago
from (values ('team_x', 20, interval '1 day'), ('team_x', 10, interval '60 days'), ('team_y', 50, interval '2 days'), ('team_z', 99, interval '1 day'))
  as v (slug, pts, ago) join public.units as u on u.slug = v.slug;
insert into public.points_ledger (unit_id, profile_id, points, reason)
select id, '00000000-0000-0000-0000-0000000000a1', 70, 'etapa aprovada' from public.units where slug = 'team_x';
select set_config('t.abc', (select id::text from public.units where slug = 'abc'), true);

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

select is((select string_agg(team_name || '=' || points, ',' order by points desc) from public.team_scoreboard(current_setting('t.abc')::uuid, null)),
  'team_y=50,team_x=30', 'desde o início: soma só pontos da equipe, só as equipes da região');
select is((select string_agg(team_name || '=' || points, ',' order by points desc) from public.team_scoreboard(current_setting('t.abc')::uuid, 30)),
  'team_y=50,team_x=20', 'últimos 30 dias: pontos antigos ficam de fora');
select is((select count(*)::int from public.team_scoreboard(null, null)), 2, 'sem escopo: usa a região da própria equipe');
select ok((select bool_and(is_mine = (team_name = 'team_x')) from public.team_scoreboard(current_setting('t.abc')::uuid, null)),
  'marca a equipe de quem está vendo');
select throws_ok($$ select * from public.team_scoreboard(current_setting('t.abc')::uuid, 0) $$, '22023', null, 'período precisa ser positivo');

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.team_scoreboard(current_setting('t.abc')::uuid, null)), 0,
  'quem é de outra região não vê o placar desta (fora do escopo → negado)');

select ok(exists (select 1 from pg_indexes where tablename = 'points_ledger' and indexname = 'idx_points_ledger_team_period'),
  'índice para o placar responder rápido com muitas equipes');

select * from finish();
rollback;
