-- Medalha da casa visível aos membros (issue #303, ADR 0014 revisão de 28/11): `public.member_houses` devolve a quem é
-- membro ativo SÓ o id e a chave da casa aceita e vigente de pessoas ativas. A RLS de `house_members` não muda.
-- Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('a',    '00000000-0000-0000-0000-0000000000c1', 'a@exemplo.org'),    -- membro ativo, casa x
  ('b',    '00000000-0000-0000-0000-0000000000c2', 'b@exemplo.org'),    -- membro ativo, casa y
  ('left', '00000000-0000-0000-0000-0000000000c3', 'left@exemplo.org'), -- saiu da casa x e está na y (vigente)
  ('wl',   '00000000-0000-0000-0000-0000000000c4', 'wl@exemplo.org'),   -- na espera, com casa
  ('susp', '00000000-0000-0000-0000-0000000000c5', 'susp@exemplo.org'), -- suspenso, com casa
  ('onb',  '00000000-0000-0000-0000-0000000000c6', 'onb@exemplo.org'),  -- liberado, casa ainda NÃO aceita (não é membro)
  ('none', '00000000-0000-0000-0000-0000000000c7', 'none@exemplo.org'), -- sem vínculo de casa
  ('gone', '00000000-0000-0000-0000-0000000000c8', 'gone@exemplo.org'); -- ativo, só tem vínculo ENCERRADO
insert into auth.users (id, email) select id, email from people;
create function pg_temp.person(p_name text) returns uuid language sql stable as $$ select id from people where name = p_name $$;
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people to authenticated;

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1' from people;
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
update public.profiles set access_status = 'active', status = 'active' where id in (select id from people where name <> 'wl');
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('wl');
update public.profiles set status = 'suspended' where id = pg_temp.person('susp');

insert into public.houses (key, active) values ('casa-x', true), ('casa-y', true) on conflict do nothing;
-- Membro de verdade exige a casa aceita (ADR 0017). `onb` tem vínculo sem aceite; `none` não tem; `gone` saiu.
insert into public.house_members (profile_id, house_key, join_method, accepted_at, left_at)
select id, 'casa-x', 'self', now() - interval '10 days', case when name = 'left' then now() - interval '5 days' end
from people where name in ('a', 'left', 'gone', 'wl', 'susp');
update public.house_members set left_at = now() - interval '1 day' where profile_id = pg_temp.person('gone');
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'casa-y', 'self', now() - interval '4 days' from people where name in ('b', 'left');
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'casa-x', 'self', null from people where name = 'onb';

-- Forma e privilégios
select has_function('public', 'member_houses', array['uuid[]'], 'a função existe');
select is(pg_get_function_result('public.member_houses(uuid[])'::regprocedure), 'TABLE(profile_id uuid, house_key text)',
  'devolve só o id e a chave da casa: nada de vínculo, datas, forma de entrada nem resultado');
select ok(not has_function_privilege('anon', 'public.member_houses(uuid[])', 'execute'), 'anon não executa');
select ok(has_function_privilege('authenticated', 'public.member_houses(uuid[])', 'execute'), 'authenticated executa (o corte é feito dentro)');

-- Quem chama: só membro ativo
set local role anon;
select throws_ok($$ select * from public.member_houses(array[pg_temp.person('a')]) $$, '42501', null, 'anônimo NÃO lê');
set local role authenticated;
select pg_temp.login('wl');
select throws_ok($$ select * from public.member_houses(array[pg_temp.person('a')]) $$, '42501', null, 'quem está na espera NÃO lê');
select pg_temp.login('onb');
select throws_ok($$ select * from public.member_houses(array[pg_temp.person('a')]) $$, '42501', null, 'liberado, mas ainda sem casa aceita (não é membro): NÃO lê');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select * from public.member_houses(array[pg_temp.person('a')]) $$, '42501', null, 'sem sessão (JWT sem sub) NÃO lê');

-- O que o membro ativo recebe
select pg_temp.login('a');
select is(
  (select count(*)::int from public.member_houses(array[pg_temp.person('a'), pg_temp.person('b')])), 2,
  'o membro ativo lê a casa dele e a de outro membro ativo');
select is(
  (select house_key from public.member_houses(array[pg_temp.person('b')])), 'casa-y',
  'a chave é a da casa aceita de quem foi pedido');
select is(
  (select house_key from public.member_houses(array[pg_temp.person('left')])), 'casa-y',
  'quem saiu de uma casa e entrou em outra mostra só a vigente');
select is(
  (select count(*)::int from public.member_houses(array[pg_temp.person('gone'), pg_temp.person('none'), pg_temp.person('onb')])), 0,
  'vínculo encerrado, sem vínculo e casa não aceita: sem linha');
select is(
  (select count(*)::int from public.member_houses(array[pg_temp.person('wl'), pg_temp.person('susp')])), 0,
  'pessoa na espera ou suspensa: sem linha');
select is(
  (select count(*)::int from public.member_houses(array[pg_temp.person('b'), pg_temp.person('b'), pg_temp.person('b')])), 1,
  'id repetido vira uma linha só');
select throws_ok($$ select * from public.member_houses(null) $$, '22023', null, 'lista nula é recusada');
select throws_ok(
  $$ select * from public.member_houses((select array_agg(gen_random_uuid()) from generate_series(1, 201))) $$,
  '22023', null, 'mais de 200 ids é recusado');

-- A RLS da tabela não mudou: as linhas dos outros seguem invisíveis por ela
select is((select count(*)::int from public.house_members where profile_id = pg_temp.person('b')), 0,
  'o membro NÃO lê o vínculo do outro pela tabela (só a chave da casa, pela função)');

select * from finish();
rollback;
