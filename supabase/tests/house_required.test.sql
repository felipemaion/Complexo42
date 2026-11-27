-- Casa antes de tudo (ADR 0017): `is_active_member` exige a casa aceita e `save_own_profile` recusa quem está liberado
-- (active) e ainda não tem casa. Quem ainda não está liberado (espera, sem linha) segue o caminho de hoje.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000e3'), ('00000000-0000-0000-0000-0000000000e4');
-- e1: ativa, perfil completo, termo aceito, SEM casa; e2: igual, COM casa aceita; e3: na espera (waitlisted), sem casa;
-- e4: sem linha (fora da lista).
insert into public.profiles (id, display_name_enc, municipality_code, consent_version, status, access_status) values
  ('00000000-0000-0000-0000-0000000000e1', pg_temp.enc('e1'), 3550308, 'v1', 'active', 'active'),
  ('00000000-0000-0000-0000-0000000000e2', pg_temp.enc('e2'), 3550308, 'v1', 'active', 'active'),
  ('00000000-0000-0000-0000-0000000000e3', pg_temp.enc('e3'), 3550308, 'v1', 'pending', 'waitlisted');
insert into public.consent_acceptances (user_id, version) values
  ('00000000-0000-0000-0000-0000000000e1', 'v1'), ('00000000-0000-0000-0000-0000000000e2', 'v1'),
  ('00000000-0000-0000-0000-0000000000e3', 'v1'), ('00000000-0000-0000-0000-0000000000e4', 'v1');
insert into public.houses (key, active) values ('casa-t1', true) on conflict do nothing;
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
values ('00000000-0000-0000-0000-0000000000e2', 'casa-t1', 'self', now());

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is(app.is_onboarding_member(), true, 'sem casa: vale como membro de entrada');
select is(app.is_active_member(), false, '... mas NÃO como membro de verdade (falta a casa aceita)');
select is((select count(*)::int from public.units), 0, '... e não lê a estrutura (unidades)');
select throws_ok($$ select public.save_own_profile(pg_temp.enc('e1'), 3550308, null, pg_temp.enc('wa'), repeat('1', 64), null, null) $$, '42501', 'house_required',
  'liberada e sem casa: salvar o perfil é recusado no banco (house_required)');
select lives_ok($$ select public.export_own_data() $$, '... mas baixa os próprios dados');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is(app.is_active_member(), true, 'com a casa aceita: membro de verdade');
select ok((select count(*) from public.units) > 0, '... lê a estrutura (unidades)');
select is(public.save_own_profile(pg_temp.enc('e2'), 3550308, null, pg_temp.enc('wa'), repeat('2', 64), null, null), 'saved', '... e salva o perfil');

select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select is(public.save_own_profile(pg_temp.enc('e3'), 3550308, null, pg_temp.enc('wa'), repeat('3', 64), null, null), 'saved',
  'na espera (não liberada), sem casa: segue o caminho de hoje e salva');
select pg_temp.login('00000000-0000-0000-0000-0000000000e4');
select is(public.save_own_profile(pg_temp.enc('e4'), 3550308, null, pg_temp.enc('wa'), repeat('4', 64), null, null), 'saved',
  'sem linha ainda (fora da lista): cria o perfil, como hoje');

select * from finish();
rollback;
