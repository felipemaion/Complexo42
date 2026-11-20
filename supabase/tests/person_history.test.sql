-- Histórico de equipes da pessoa (#69, ADR 0007 §1–2): mover preserva o vínculo antigo (com data de
-- saída) e a coordenação vê as equipes e os porta-vozes de cada período. Fora do escopo não vê.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

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

-- c1 coordena a ABC | a1 muda da X para a Y | b1 porta-voz da X | f1 monitor da ZL (fora)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000f1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'manager', (select id from public.units where slug = 'abc')),
  ('00000000-0000-0000-0000-0000000000b1', 'spokesperson', (select id from public.units where slug = 'team_x')),
  ('00000000-0000-0000-0000-0000000000f1', 'monitor', (select id from public.units where slug = 'zl'));
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values ('abc', '00000000-0000-0000-0000-0000000000c1'::uuid), ('team_x', '00000000-0000-0000-0000-0000000000a1'),
  ('team_x', '00000000-0000-0000-0000-0000000000b1'), ('zl', '00000000-0000-0000-0000-0000000000f1')) as v (slug, p)
  join public.units as u on u.slug = v.slug;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.move_to_team('00000000-0000-0000-0000-0000000000a1',
  (select id from public.units where slug = 'team_x'), (select id from public.units where slug = 'team_y'));

select is((select string_agg(team_name || ':' || (left_at is null)::text, ',' order by joined_at) from public.person_history('00000000-0000-0000-0000-0000000000a1')),
  'team_x:false,team_y:true', 'mover preserva o histórico: a equipe antiga fica com data de saída');
select is((select jsonb_array_length(spokespeople) from public.person_history('00000000-0000-0000-0000-0000000000a1') where team_name = 'team_x'), 1,
  'mostra o porta-voz da equipe naquele período (nome cifrado, o app decifra)');

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.person_history('00000000-0000-0000-0000-0000000000a1')), 0,
  'coordenação de outra região não vê o histórico (fora do escopo → negado)');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.person_history('00000000-0000-0000-0000-0000000000a1')), 0,
  'a tela de histórico é da coordenação (a pessoa vê os próprios dados no "Baixar meus dados")');

select * from finish();
rollback;
