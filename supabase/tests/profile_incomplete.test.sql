-- Perfil incompleto (ADR 0017, base do "casa antes de tudo"): a linha de `profiles` nasce no primeiro login de quem
-- tem acesso liberado, sem nome nem município; os nulos só valem enquanto `profile_completed_at` é nulo, e ninguém
-- volta a incompleto. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- c1: na lista de autorizados; c2: fora da lista; c3: com perfil completo (migração dos já existentes).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3');
insert into public.consent_acceptances (user_id, version)
select id, 'v1' from auth.users where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3');
insert into public.access_allowlist (email_hmac, source) values (repeat('1', 64), 'manual');

-- ---------------------------------------------------------------------------------------
-- A linha nasce no primeiro login, só de quem tem acesso liberado
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(public.resolve_access(repeat('1', 64)), 'active', 'quem está na lista é liberado no primeiro login, mesmo sem perfil');
select results_eq(
  $$ select display_name_enc is null, municipality_code is null, state_code is null, profile_completed_at is null, access_status, status
     from public.profiles where id = '00000000-0000-0000-0000-0000000000c1' $$,
  $$ values (true, true, true, true, 'active'::text, 'active'::text) $$,
  'a linha nasce incompleta (sem nome, município nem UF), ativa');
select is(public.resolve_access(repeat('1', 64)), 'active', 'chamar de novo é idempotente');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 1, '... e não duplica a linha');

select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(public.resolve_access(repeat('2', 64)), null, 'quem não está na lista NÃO ganha linha (segue o caminho de hoje: perfil e espera)');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 0, '... nenhuma linha para quem não tem acesso liberado');

-- ---------------------------------------------------------------------------------------
-- Completar o perfil: só por save_own_profile
-- ---------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(
  public.save_own_profile(pg_temp.enc('c1'), 3550308, null, pg_temp.enc('wa'), repeat('a', 64), null, null),
  'saved', 'a pessoa de perfil incompleto o completa pela função');
select results_eq(
  $$ select display_name_enc = pg_temp.enc('c1'), municipality_code, state_code::text, profile_completed_at is not null, consent_version
     from public.profiles where id = '00000000-0000-0000-0000-0000000000c1' $$,
  $$ values (true, 3550308, 'SP'::text, true, 'v1'::text) $$,
  '... nome, município, UF e versão do termo gravados e o perfil marcado como completo');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(public.save_own_profile(pg_temp.enc('c3'), 3550308, null, pg_temp.enc('wa'), repeat('b', 64), null, null), 'saved',
  'quem não tinha linha cria e completa o perfil num passo só (caminho de hoje)');
select is((select profile_completed_at is not null from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'), true, '... marcado como completo');

-- ---------------------------------------------------------------------------------------
-- Restrições: nulos só enquanto incompleto; ninguém volta a incompleto
-- ---------------------------------------------------------------------------------------
reset role;
select lives_ok($$ insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c4');
                   insert into public.profiles (id, status, access_status) values ('00000000-0000-0000-0000-0000000000c4', 'active', 'active') $$,
  'a tabela aceita a linha incompleta (nulos enquanto incompleto)');
select throws_ok($$ update public.profiles set display_name_enc = null where id = '00000000-0000-0000-0000-0000000000c1' $$, '23514', null,
  'perfil completo NÃO aceita nome nulo');
select throws_ok($$ update public.profiles set municipality_code = null where id = '00000000-0000-0000-0000-0000000000c1' $$, '23514', null,
  'perfil completo NÃO aceita município nulo');
select throws_ok($$ update public.profiles set profile_completed_at = null where id = '00000000-0000-0000-0000-0000000000c1' $$, '23514', null,
  'perfil completo NÃO volta a incompleto');
select throws_ok($$ update public.profiles set profile_completed_at = now() where id = (select id from public.profiles where id = '00000000-0000-0000-0000-0000000000c4') $$, '23514', null,
  'perfil incompleto NÃO pode ser marcado completo sem nome e município');
-- ---------------------------------------------------------------------------------------
-- Exportação ("Baixar meus dados") de quem tem perfil incompleto: não quebra
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select lives_ok($$ select public.export_own_data() $$, 'exportar com perfil incompleto não quebra');
select is((public.export_own_data() -> 'profile' ->> 'profile_completed_at'), null, '... e o perfil sai marcado como incompleto');

select * from finish();
rollback;
