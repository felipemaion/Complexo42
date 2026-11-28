-- Perfil público (#305): preferências de medalha (grava só pela função, RLS do dono) e `public_profile`
-- (membro ativo vê; bloqueado, inexistente e quem está bloqueado dão zero linhas).
-- Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- f1: dono; f2: outra pessoa ativa; f3: bloqueada.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-0000000000f3');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000f1', pg_temp.enc('NomeF1'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000f2', pg_temp.enc('NomeF2'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000f3', pg_temp.enc('NomeF3'), 3550308, 'v1');
update public.profiles set access_status = 'active', status = 'active'
where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');
update public.profiles set access_status = 'blocked' where id = '00000000-0000-0000-0000-0000000000f3';
insert into public.consent_acceptances (user_id, version) select id, 'v1' from public.profiles on conflict do nothing;
-- Membro de verdade exige a casa aceita (ADR 0017).
insert into public.houses (key, active) select 'g-' || id::text, true from public.profiles
where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3') on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
select id, 'g-' || id::text, 'self', now() from public.profiles
where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3') on conflict do nothing;

select has_table('public', 'profile_badge_prefs', 'a tabela existe');
select ok((select relrowsecurity from pg_class where oid = 'public.profile_badge_prefs'::regclass), 'RLS habilitada (R5)');
select ok(
  (select not has_table_privilege('authenticated', 'public.profile_badge_prefs', 'INSERT')
      and not has_table_privilege('authenticated', 'public.profile_badge_prefs', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.profile_badge_prefs', 'DELETE')),
  'a API não grava direto: só a função'
);

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');

-- Sem linhas: padrão
select is((select badges from public.public_profile('00000000-0000-0000-0000-0000000000f1')), array['house', 'totem'], 'sem escolha vale o padrão');

-- O dono ordena e esconde
select lives_ok($$ select public.set_my_badge_prefs(array['totem', 'house'], array[true, true]) $$, 'o dono grava a ordem');
select is((select badges from public.public_profile('00000000-0000-0000-0000-0000000000f1')), array['totem', 'house'], 'a ordem escolhida vale');
select lives_ok($$ select public.set_my_badge_prefs(array['totem', 'house'], array[true, false]) $$, 'o dono esconde uma medalha');
select is((select badges from public.public_profile('00000000-0000-0000-0000-0000000000f1')), array['totem'], 'só a visível aparece');
select is((select count(*)::int from public.profile_badge_prefs), 2, 'o dono lê as próprias linhas');
select is(jsonb_array_length(public.export_own_data()->'badge_prefs'), 2, 'baixar meus dados traz as medalhas escolhidas');

-- Entradas inválidas
select throws_ok($$ select public.set_my_badge_prefs(array['house', 'house'], array[true, true]) $$, '22023', null, 'tipo repetido é recusado');
select throws_ok($$ select public.set_my_badge_prefs(array['xyz'], array[true]) $$, '22023', null, 'tipo fora da lista é recusado');
select throws_ok($$ select public.set_my_badge_prefs(array['house'], array[true, true]) $$, '22023', null, 'tamanhos diferentes são recusados');

-- Outra pessoa ativa: vê o perfil (com a escolha do dono), mas não lê a tabela
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is((select badges from public.public_profile('00000000-0000-0000-0000-0000000000f1')), array['totem'], 'outro membro ativo vê o perfil na ordem do dono');
select is((select count(*)::int from public.profile_badge_prefs), 0, 'outro membro não lê a tabela direto');

-- Bloqueada e inexistente: zero linhas, sem distinguir
select is((select count(*)::int from public.public_profile('00000000-0000-0000-0000-0000000000f3')), 0, 'perfil bloqueado: zero linhas');
select is((select count(*)::int from public.public_profile('00000000-0000-0000-0000-00000000ffff')), 0, 'inexistente: zero linhas (igual)');

-- Quem está bloqueada não vê ninguém
select pg_temp.login('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.public_profile('00000000-0000-0000-0000-0000000000f1')), 0, 'quem está bloqueada não vê perfis');

select * from finish();
rollback;
