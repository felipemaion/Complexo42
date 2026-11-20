-- "Baixar meus dados" com o que veio depois do #20 (LGPD art. 18, II): medalhas, portfólio,
-- pontos, entregas de missão e mensagens da equipe. Só os dados de quem pede. Pessoas fictícias.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

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

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.unit_members (unit_id, profile_id)
select id, v.p from public.units, (values ('00000000-0000-0000-0000-0000000000a1'::uuid), ('00000000-0000-0000-0000-0000000000a2')) as v (p)
where slug = 'team_x';

-- Dados de a1 e de a2 gravados direto (o teste é da exportação, não das regras de cada tabela).
insert into public.badges (id, scope_unit_id, name) select '00000000-0000-0000-0000-0000000000b1', id, 'Primeira entrega' from public.units where slug = 'abc';
insert into public.profile_badges (profile_id, badge_id, reason) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'Motivo da a1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 'Motivo da a2');
insert into public.portfolio_items (profile_id, url_enc, kind, title, position) values
  ('00000000-0000-0000-0000-0000000000a1', pg_temp.enc('link-a1'), 'video', 'Vídeo da a1', 1),
  ('00000000-0000-0000-0000-0000000000a2', pg_temp.enc('link-a2'), 'text', 'Texto da a2', 1);
insert into public.points_ledger (unit_id, profile_id, points, reason)
select id, '00000000-0000-0000-0000-0000000000a1', 30, 'etapa aprovada' from public.units where slug = 'team_x';
insert into public.points_ledger (unit_id, profile_id, points, reason)
select id, '00000000-0000-0000-0000-0000000000a2', 99, 'etapa aprovada' from public.units where slug = 'team_x';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_config('t.out', public.export_own_activity()::text, true);

select is((current_setting('t.out')::jsonb -> 'badges' -> 0 ->> 'reason'), 'Motivo da a1', 'traz as medalhas da pessoa, com o motivo');
select is(jsonb_array_length(current_setting('t.out')::jsonb -> 'badges'), 1, 'não traz medalha de outra pessoa');
select is((current_setting('t.out')::jsonb -> 'portfolio' -> 0 ->> 'title'), 'Vídeo da a1', 'traz o portfólio (link ainda cifrado)');
select is(jsonb_array_length(current_setting('t.out')::jsonb -> 'portfolio'), 1, 'não traz portfólio de outra pessoa');
select is((current_setting('t.out')::jsonb ->> 'points_total')::int, 30, 'o total de pontos é só o da pessoa');
select ok(position('link-a2' in current_setting('t.out')) = 0 and position('Motivo da a2' in current_setting('t.out')) = 0,
  'nada de outra pessoa aparece em lugar nenhum do arquivo');
select is(jsonb_typeof(current_setting('t.out')::jsonb -> 'submissions'), 'array', 'traz a lista de entregas (vazia aqui)');

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.export_own_activity() $$, '42501', null, 'quem não entrou não exporta nada');

select * from finish();
rollback;
