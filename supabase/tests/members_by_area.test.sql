-- Mapa de onde estão as pessoas (#24, RF08): contagem por município e por distrito da capital, só
-- dentro do escopo de quem coordena; menos de 5 pessoas sai sem número ("< 5"). Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

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
select pg_temp.add_unit('state', 'br', 'rj', 'RJ');

insert into public.municipalities (code, name, state_code) values (3550308, 'São Paulo', 'SP'), (3548708, 'São Bernardo do Campo', 'SP'), (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
-- 6 pessoas na capital (Sé), 2 em São Bernardo, 7 no Rio (outro estado); c1 coordena SP
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 15) as n;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000e1');
insert into public.profiles (id, display_name_enc, municipality_code, district_code, consent_version)
select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, pg_temp.enc('n'),
       case when n <= 6 then 3550308 when n <= 8 then 3548708 else 3304557 end,
       case when n <= 6 then 355030878 else null end, 'termo-teste'  -- 355030878 = Sé (public.districts)
from generate_series(1, 15) as n;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000c1', pg_temp.enc('n'), 3550308, 'termo-teste'),
  ('00000000-0000-0000-0000-0000000000e1', pg_temp.enc('n'), 3550308, 'termo-teste');
update public.profiles set access_status = 'active', status = 'active';
-- Ativar o perfil já cria uma filiação automática; o teste monta as suas.
delete from public.unit_members;
insert into public.unit_members (unit_id, profile_id)
select (select id from public.units where slug = case when n <= 8 then 'abc' else 'rj' end),
       ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid
from generate_series(1, 15) as n;
insert into public.unit_members (unit_id, profile_id) values
  ((select id from public.units where slug = 'sp'), '00000000-0000-0000-0000-0000000000c1'),
  ((select id from public.units where slug = 'abc'), '00000000-0000-0000-0000-0000000000e1');
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'manager', id from public.units where slug = 'sp';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is((select people from public.members_by_area() where kind = 'municipio' and code = 3550308), 8,
  'conta as pessoas da capital no escopo (6 + e1 + a própria coordenação)');
select is((select people from public.members_by_area() where kind = 'municipio' and code = 3548708), null,
  'menos de 5 pessoas sai sem número (< 5)');
select is((select count(*)::int from public.members_by_area() where kind = 'municipio' and code = 3304557), 0,
  'gestor de SP não vê outros estados (fora do escopo → negado)');
select is((select people from public.members_by_area() where kind = 'distrito' and label = 'Sé'), 6, 'conta por distrito da capital');

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((select count(*)::int from public.members_by_area()), 0, 'quem não coordena não vê o mapa');

select * from finish();
rollback;
