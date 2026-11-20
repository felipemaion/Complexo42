-- Avaliação reservada (ADR 0007 §4, ADR 0008 §3), painel da coordenação (#49) e conversa da
-- equipe (ata de 17/11 §8, #120). Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

-- c1 monitor da região | e1 coordenador (lead) da equipe X | a1, a2 equipe X | b1 equipe Y
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b1');
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('n'), 3304557, 'termo-teste' from auth.users
where id::text like '00000000-0000-0000-0000-0000000000%';
update public.profiles set access_status = 'active', status = 'active'
where id::text like '00000000-0000-0000-0000-0000000000%';
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'monitor', id from public.units where slug = 'abc';
insert into public.unit_members (unit_id, profile_id, member_role)
select u.id, v.p, v.r from (values
  ('abc', '00000000-0000-0000-0000-0000000000c1'::uuid, 'member'),
  ('team_x', '00000000-0000-0000-0000-0000000000e1', 'lead'),
  ('team_x', '00000000-0000-0000-0000-0000000000a1', 'member'),
  ('team_x', '00000000-0000-0000-0000-0000000000a2', 'member'),
  ('team_y', '00000000-0000-0000-0000-0000000000b1', 'member')
) as v (slug, p, r) join public.units as u on u.slug = v.slug;
select set_config('t.team_x', (select id::text from public.units where slug = 'team_x'), true);

set local role authenticated;

-- Avaliação
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.submit_evaluation('00000000-0000-0000-0000-0000000000a1', 'team', pg_temp.enc('ouro'), null, current_date) $$,
  '42501', null, 'membro comum não avalia o colega');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$ select public.submit_evaluation('00000000-0000-0000-0000-0000000000e1', 'team', pg_temp.enc('ouro'), null, current_date) $$,
  '42501', null, 'ninguém avalia a si mesmo');
select lives_ok($$ select public.submit_evaluation('00000000-0000-0000-0000-0000000000a1', 'team', pg_temp.enc('prata'), pg_temp.enc('nota'), current_date) $$,
  'o coordenador da equipe avalia o membro (eixo equipe)');
select throws_ok($$ select public.submit_evaluation('00000000-0000-0000-0000-0000000000b1', 'team', pg_temp.enc('ouro'), null, current_date) $$,
  '42501', null, 'coordenador de uma equipe não avalia gente de outra');
select is((select count(*)::int from public.my_given_evaluations()), 1, 'quem avaliou vê a avaliação que deu');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.member_evaluations), 0, 'a pessoa avaliada não lê a avaliação (reservada, ADR 0007 §4)');
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.member_evaluations), 0, 'nem a coordenação lê a avaliação de outro avaliador');

-- Painel
select is((select member_count from public.team_dashboard() where team_id = current_setting('t.team_x')::uuid), 3,
  'o painel mostra as pessoas da equipe para a coordenação');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is_empty($$ select * from public.team_dashboard() $$, 'membro sem papel não vê o painel');

-- Conversa da equipe
select lives_ok($$ select public.post_team_message(current_setting('t.team_x')::uuid, pg_temp.enc('oi')) $$,
  'membro escreve na conversa da própria equipe');
select throws_ok($$ select public.post_team_message(current_setting('t.team_x')::uuid, 'texto em claro') $$,
  '22023', null, 'mensagem que não veio cifrada pelo app é recusada (R13)');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select * from public.team_messages_for(current_setting('t.team_x')::uuid) $$,
  '42501', null, 'gente de outra equipe não lê a conversa');
select is((select count(*)::int from public.team_messages), 0, 'nem pela tabela');

reset role;
select lives_ok($$ delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'excluir a conta de quem foi avaliado e escreveu na conversa funciona (avaliação e mensagens vão junto)');

select * from finish();
rollback;
