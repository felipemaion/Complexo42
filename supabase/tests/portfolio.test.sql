-- Portfólio por links (#70, ADR 0007 §5, MODELO_DADOS): até 3 links cifrados por pessoa, sem
-- arquivo. A própria pessoa adiciona e tira; vê quem pode ver o perfil (escopo). Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select ok((select relrowsecurity from pg_class where oid = 'public.portfolio_items'::regclass), 'portfolio_items tem RLS ligada');

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

-- a1 dona do portfólio | c1 monitor ABC | z1 membro de outra região
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
select '00000000-0000-0000-0000-0000000000c1', 'monitor', id from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id)
select u.id, v.p from (values
  ('team_x', '00000000-0000-0000-0000-0000000000a1'::uuid), ('abc', '00000000-0000-0000-0000-0000000000c1'),
  ('zl', '00000000-0000-0000-0000-0000000000f1')
) as v (slug, p) join public.units as u on u.slug = v.slug;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

select throws_ok($$ select public.add_portfolio_item('https://youtube.com/watch?v=abc', 'video', 'Meu vídeo') $$,
  '22023', null, 'link em texto puro é recusado (só cifrado, ADR 0003)');
select throws_ok($$ select public.add_portfolio_item(pg_temp.enc('u1'), 'video', repeat('t', 81)) $$,
  '22023', null, 'título com mais de 80 letras é recusado');
select throws_ok($$ select public.add_portfolio_item(pg_temp.enc('u1'), 'audio', 'Podcast') $$,
  '22023', null, 'tipo fora da lista é recusado');
select lives_ok($$ select public.add_portfolio_item(pg_temp.enc('u1'), 'video', 'Corte do debate') $$, 'a pessoa adiciona um item');
select public.add_portfolio_item(pg_temp.enc('u2'), 'image', 'Arte da campanha');
select public.add_portfolio_item(pg_temp.enc('u3'), 'text', 'Artigo no jornal');
select throws_ok($$ select public.add_portfolio_item(pg_temp.enc('u4'), 'other', 'O quarto') $$,
  '22023', null, 'o 4º item é recusado (até 3)');
select throws_ok($$ insert into public.portfolio_items (profile_id, url_enc, kind, title, position)
  values ('00000000-0000-0000-0000-0000000000a1', pg_temp.enc('x'), 'video', 'direto', 1) $$,
  '42501', null, 'ninguém grava direto na tabela (só pela função)');

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.portfolio_list('00000000-0000-0000-0000-0000000000a1')), 0,
  'quem está fora do escopo não vê o portfólio (fora do escopo → negado)');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is((select string_agg(title, ',' order by position) from public.portfolio_list('00000000-0000-0000-0000-0000000000a1')),
  'Corte do debate,Arte da campanha,Artigo no jornal', 'a coordenação do escopo vê os itens na ordem');
select throws_ok($$ select public.remove_portfolio_item((select id from public.portfolio_list('00000000-0000-0000-0000-0000000000a1') limit 1)) $$,
  '42501', null, 'só a dona tira itens do próprio portfólio');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.remove_portfolio_item((select id from public.portfolio_list('00000000-0000-0000-0000-0000000000a1') where title = 'Arte da campanha'));
select is((select string_agg(title || ':' || position, ',' order by position) from public.portfolio_list('00000000-0000-0000-0000-0000000000a1')),
  'Corte do debate:1,Artigo no jornal:2', 'ao tirar um item, os outros sobem de posição');

select * from finish();
rollback;
