-- Aceite do termo (issue #11): `public.accept_consent` é a única via que muda
-- `profiles.consent_version`; grava a versão e a data, audita e não age sobre outra pessoa.
-- Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- c1: perfil sem aceite; c2: outra pessoa sem aceite; c3: bloqueada; c4: sem perfil.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-0000000000c4');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000c1', pg_temp.enc('c1'), 3550308, 'none'),
  ('00000000-0000-0000-0000-0000000000c2', pg_temp.enc('c2'), 3550308, 'none'),
  ('00000000-0000-0000-0000-0000000000c3', pg_temp.enc('c3'), 3550308, 'none');
update public.profiles set access_status = 'blocked' where id = '00000000-0000-0000-0000-0000000000c3';

select ok(
  not has_function_privilege('anon', 'public.accept_consent(text)', 'execute')
  and has_function_privilege('authenticated', 'public.accept_consent(text)', 'execute'),
  'só quem está logado executa accept_consent'
);

set local role authenticated;

-- Sem sessão (JWT sem pessoa): recusado.
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
select throws_ok($$ select public.accept_consent('v1') $$, '42501', null, 'sem sessão → negado');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.accept_consent('none') $$, '22023', null, 'none não é versão de termo');
select throws_ok($$ select public.accept_consent('v 1; drop') $$, '22023', null, 'versão fora do formato → recusada');
select throws_ok($$ select public.accept_consent(null) $$, '22023', null, 'versão nula → recusada');

select is(public.accept_consent('v1'), 'accepted', 'a pessoa aceita a versão v1');
select is(
  (select consent_version from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'v1',
  'consent_version avançou para v1'
);

-- Escrita direta continua fechada: só a função muda a versão.
select throws_ok(
  $$ update public.profiles set consent_version = 'v9' where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '42501', null, 'UPDATE direto em consent_version é negado'
);

-- Outra pessoa continua sem aceite: a função só age sobre quem chama.
select is(
  (select consent_version from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'),
  null,
  'a RLS não mostra o perfil de outra pessoa (fora do escopo → negado)'
);
reset role;
select is(
  (select consent_version from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'),
  'none',
  'o perfil de outra pessoa segue sem aceite'
);

-- Repetir a mesma versão não regrava nem audita de novo.
select pg_sleep(0.01);
create temp table before_repeat as
  select consent_at from public.profiles where id = '00000000-0000-0000-0000-0000000000c1';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.accept_consent('v1');
reset role;
select is(
  (select p.consent_at = b.consent_at from public.profiles as p, before_repeat as b
   where p.id = '00000000-0000-0000-0000-0000000000c1'),
  true,
  'repetir o aceite não muda consent_at'
);

-- Nova versão: novo aceite, nova data, novo evento.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.accept_consent('v2');
reset role;
select is(
  (select array_agg(event || ':' || term_version order by id) from public.audit_log
   where actor_id = '00000000-0000-0000-0000-0000000000c1'),
  array['consent_accepted:v1', 'consent_accepted:v2'],
  'cada versão aceita gera um evento de auditoria, e repetir não gera'
);

-- Bloqueada: negado. Sem perfil: resultado esperado, sem erro e sem auditoria.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select public.accept_consent('v1') $$, '42501', null, 'conta bloqueada → negado');
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select is(public.accept_consent('v1'), 'no_profile', 'sem perfil, devolve no_profile');
reset role;
select is(
  (select count(*)::int from public.audit_log where actor_id = '00000000-0000-0000-0000-0000000000c4'),
  0,
  'sem perfil, nada é auditado'
);

select * from finish();
rollback;
