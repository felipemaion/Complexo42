-- Aceite do termo (issue #11): `public.accept_consent` grava em `consent_acceptances` só a versão
-- vigente, só de quem chama, com auditoria, e funciona sem perfil. A tabela só se lê pela API.
-- Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- c1: com perfil; c2: outra pessoa com perfil; c3: bloqueada; c4: sem perfil.
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
select is(app.current_consent_version(), 'v1', 'a versão vigente do termo é v1');

set local role authenticated;

-- Sem sessão (JWT sem pessoa): recusado.
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
select throws_ok($$ select public.accept_consent('v1') $$, '42501', null, 'sem sessão → negado');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.accept_consent('v2') $$, '22023', null, 'versão futura → recusada (ninguém pré-aceita)');
select throws_ok($$ select public.accept_consent('none') $$, '22023', null, 'none não é versão de termo');
select throws_ok($$ select public.accept_consent('v0') $$, '22023', null, 'versão antiga → recusada');
select throws_ok($$ select public.accept_consent(null) $$, '22023', null, 'versão nula → recusada');
select is(
  (select count(*)::int from public.consent_acceptances),
  0,
  'nada foi gravado pelas recusas'
);

select is(public.accept_consent('v1'), 'accepted', 'a pessoa aceita a versão vigente');
select is(
  (select array_agg(version) from public.consent_acceptances),
  array['v1'],
  'a pessoa lê o próprio aceite'
);

-- Escrita direta continua fechada: só a função grava.
select throws_ok(
  $$ insert into public.consent_acceptances (user_id, version)
     values ('00000000-0000-0000-0000-0000000000c1', 'v1') $$,
  '42501', null, 'INSERT direto em consent_acceptances é negado'
);
select throws_ok(
  $$ update public.profiles set consent_version = 'v9' where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '42501', null, 'UPDATE direto em consent_version é negado'
);

-- Outra pessoa não vê o aceite alheio (fora do escopo → negado) e continua sem aceite.
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(
  (select count(*)::int from public.consent_acceptances),
  0,
  'a RLS não mostra o aceite de outra pessoa'
);
reset role;
select is(
  (select consent_version from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'),
  'none',
  'o perfil de outra pessoa segue sem aceite'
);

-- O espelho do perfil avançou com a data; repetir não regrava nem audita de novo.
select is(
  (select consent_version from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'v1',
  'profiles.consent_version espelha o aceite'
);
create temp table before_repeat as
  select accepted_at from public.consent_acceptances where user_id = '00000000-0000-0000-0000-0000000000c1';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.accept_consent('v1');
reset role;
select is(
  (select c.accepted_at = b.accepted_at from public.consent_acceptances as c, before_repeat as b
   where c.user_id = '00000000-0000-0000-0000-0000000000c1'),
  true,
  'repetir o aceite não muda a data'
);
select is(
  (select array_agg(event || ':' || term_version) from public.audit_log
   where actor_id = '00000000-0000-0000-0000-0000000000c1'),
  array['consent_accepted:v1'],
  'o aceite gera um evento de auditoria, e repetir não gera outro'
);

-- Bloqueada: negado. Sem perfil: aceita, e o aceite fica à espera do perfil.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select public.accept_consent('v1') $$, '42501', null, 'conta bloqueada → negado');
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select is(public.accept_consent('v1'), 'accepted', 'sem perfil, o aceite também vale');
reset role;
select is(
  (select count(*)::int from public.consent_acceptances where user_id = '00000000-0000-0000-0000-0000000000c4'),
  1,
  'o aceite de quem não tem perfil fica gravado'
);

select * from finish();
rollback;
