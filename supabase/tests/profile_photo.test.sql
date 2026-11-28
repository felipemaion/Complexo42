-- Foto do perfil (#308): estrutura, gravação só por `save_own_photo` (formato e limite de 10 por hora),
-- RLS do ponto de vista do dono e de quem não é membro ativo, grants fechados e cascata na exclusão.
-- Quem é membro ativo e lê a foto dos outros está em permissions_matrix.test.sql (R16). Pessoas
-- fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- e1: dono; e2: outra pessoa ativa (ainda sem casa: não é membro de verdade); e3: bloqueada; e4: para o limite.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000e3'),
  ('00000000-0000-0000-0000-0000000000e4');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000e1', pg_temp.enc('NomeE1'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000e2', pg_temp.enc('NomeE2'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000e3', pg_temp.enc('NomeE3'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000e4', pg_temp.enc('NomeE4'), 3550308, 'v1');
update public.profiles set access_status = 'active', status = 'active'
where id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e4');
update public.profiles set access_status = 'blocked' where id = '00000000-0000-0000-0000-0000000000e3';

-- Estrutura
select has_table('public', 'profile_photos', 'a tabela existe');
select col_is_pk('public', 'profile_photos', 'profile_id', 'uma linha por pessoa (1:1 com o perfil)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profile_photos'::regclass),
  'RLS habilitada (R5)'
);
select ok(
  (select not has_table_privilege('authenticated', 'public.profile_photos', 'INSERT')
      and not has_table_privilege('authenticated', 'public.profile_photos', 'UPDATE')),
  'a API não tem INSERT nem UPDATE direto: só a função grava'
);

-- O dono grava por `save_own_photo`, lê e apaga a própria foto
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$ select public.save_own_photo(pg_temp.enc('primeira')) $$, 'o dono grava a foto');
select is((select count(*)::int from public.profile_photos), 1, 'o dono lê a própria foto');
select lives_ok($$ select public.save_own_photo(pg_temp.enc('segunda')) $$, 'trocar a foto também funciona');
select is(
  (select photo_enc from public.profile_photos), pg_temp.enc('segunda'),
  'a troca substitui a linha (continua uma só)'
);

-- Formato: texto puro e valor grande demais são recusados pela função
select throws_ok(
  $$ select public.save_own_photo('RIFF....WEBP') $$,
  '23514', null, 'texto puro é recusado (ADR 0003)'
);
select throws_ok(
  $$ select public.save_own_photo('v1.AAAAAAAAAAAAAAAA.' || repeat('x', 70000)) $$,
  '23514', null, 'valor cifrado acima do teto é recusado'
);

-- Grants fechados
select throws_ok(
  $$ insert into public.profile_photos (profile_id, photo_enc)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.enc('x')) $$,
  '42501', 'permission denied for table profile_photos', 'sem INSERT direto'
);
select throws_ok(
  $$ update public.profile_photos set photo_enc = pg_temp.enc('y') $$,
  '42501', 'permission denied for table profile_photos', 'sem UPDATE direto'
);

-- Quem não é o dono, nem membro ativo
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is_empty($$ select 1 from public.profile_photos $$, 'outra pessoa, sem casa aceita, NÃO lê a foto do dono');
select is_empty(
  $$ delete from public.profile_photos returning 1 $$,
  'outra pessoa NÃO remove a foto do dono'
);

-- Perfil bloqueado não grava
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select throws_ok(
  $$ select public.save_own_photo(pg_temp.enc('z')) $$,
  '42501', null, 'perfil bloqueado NÃO grava'
);

-- O dono remove a própria foto
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$ delete from public.profile_photos $$, 'o dono remove a própria foto');
select is((select count(*)::int from public.profile_photos), 0, 'a linha sumiu');

-- Limite: 10 envios por hora por pessoa (PT429)
select pg_temp.login('00000000-0000-0000-0000-0000000000e4');
select lives_ok(
  $$ select public.save_own_photo(pg_temp.enc('n' || n)) from generate_series(1, 10) as n $$,
  '10 envios na mesma hora passam'
);
select throws_ok(
  $$ select public.save_own_photo(pg_temp.enc('onze')) $$,
  'PT429', 'too_many_attempts', 'o 11º envio na hora é recusado'
);

-- Anônimo
reset role;
set local role anon;
select throws_ok(
  $$ select 1 from public.profile_photos $$,
  '42501', 'permission denied for table profile_photos', 'anônimo NÃO lê'
);
select throws_ok(
  $$ select public.save_own_photo('v1.AAAAAAAAAAAAAAAA.xxxxxxxxxxxxxxxxxxxxxx') $$,
  '42501', null, 'anônimo NÃO grava'
);

-- Exclusão da conta: a foto vai junto (cascata)
reset role;
insert into public.profile_photos (profile_id, photo_enc)
values ('00000000-0000-0000-0000-0000000000e2', pg_temp.enc('cascata'));
delete from public.profiles where id = '00000000-0000-0000-0000-0000000000e2';
select is(
  (select count(*)::int from public.profile_photos where profile_id = '00000000-0000-0000-0000-0000000000e2'),
  0, 'apagar o perfil apaga a foto'
);

select * from finish();
rollback;
