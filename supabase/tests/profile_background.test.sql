-- Formação e atividade profissional (#304): estrutura, formato dos valores cifrados, RLS do ponto
-- de vista do dono e de quem não é do escopo, grants fechados e cascata na exclusão. Quem da
-- coordenação lê, por papel e escopo, está em permissions_matrix.test.sql (R16). Pessoas fictícias,
-- só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- c1: dono; c2: outra pessoa ativa, sem papel; c3: bloqueada.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000c1', pg_temp.enc('NomeC1'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000c2', pg_temp.enc('NomeC2'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000c3', pg_temp.enc('NomeC3'), 3550308, 'v1');
update public.profiles set access_status = 'active', status = 'active'
where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');
update public.profiles set access_status = 'blocked' where id = '00000000-0000-0000-0000-0000000000c3';

-- Estrutura
select has_table('public', 'profile_background', 'a tabela existe');
select col_is_pk('public', 'profile_background', 'profile_id', 'uma linha por pessoa (1:1 com o perfil)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profile_background'::regclass),
  'RLS habilitada (R5)'
);

-- O dono grava e lê a própria linha
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ insert into public.profile_background (profile_id, education_level_enc, education_detail_enc, occupation_enc)
     values ('00000000-0000-0000-0000-0000000000c1', pg_temp.enc('nivel'), pg_temp.enc('qual'), pg_temp.enc('atividade')) $$,
  'o dono cria a própria linha'
);
select is((select count(*)::int from public.profile_background), 1, 'o dono lê a própria linha');
select lives_ok(
  $$ update public.profile_background set occupation_enc = pg_temp.enc('nova') $$,
  'o dono atualiza a própria linha'
);
select is(
  (select occupation_enc from public.profile_background), pg_temp.enc('nova'),
  'o valor novo foi gravado'
);

-- Formato: o banco recusa texto puro e valor cifrado grande demais.
select throws_ok(
  $$ update public.profile_background set occupation_enc = 'Engenheira' $$,
  '23514', null, 'texto puro é recusado (ADR 0003)'
);
select throws_ok(
  $$ update public.profile_background set education_detail_enc = 'v1.AAAAAAAAAAAAAAAA.' || repeat('x', 700) $$,
  '23514', null, 'valor cifrado acima do teto é recusado'
);
select throws_ok(
  $$ update public.profile_background set profile_id = '00000000-0000-0000-0000-0000000000c2' $$,
  '42501', null, 'a chave da linha não pode ser trocada'
);
select throws_ok(
  $$ delete from public.profile_background $$,
  '42501', 'permission denied for table profile_background', 'nada é apagado pela API'
);

-- Quem não é o dono nem da coordenação do escopo
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is_empty($$ select 1 from public.profile_background $$, 'outra pessoa ativa NÃO lê a linha do dono');
select throws_ok(
  $$ insert into public.profile_background (profile_id, occupation_enc)
     values ('00000000-0000-0000-0000-0000000000c1', pg_temp.enc('x')) $$,
  '42501', null, 'outra pessoa NÃO cria a linha do dono'
);
select is_empty(
  $$ update public.profile_background set occupation_enc = pg_temp.enc('y') returning 1 $$,
  'outra pessoa NÃO altera a linha do dono'
);

select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok(
  $$ insert into public.profile_background (profile_id, occupation_enc)
     values ('00000000-0000-0000-0000-0000000000c3', pg_temp.enc('z')) $$,
  '42501', null, 'perfil bloqueado NÃO grava'
);

reset role;
set local role anon;
select throws_ok(
  $$ select 1 from public.profile_background $$,
  '42501', 'permission denied for table profile_background', 'anônimo NÃO lê'
);

-- Exclusão da conta: a linha vai junto (cascata)
reset role;
delete from public.profiles where id = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select count(*)::int from public.profile_background where profile_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'apagar o perfil apaga formação e atividade'
);

select * from finish();
rollback;
