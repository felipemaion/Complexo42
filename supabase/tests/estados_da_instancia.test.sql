-- #365: os 27 estados nascem por migration (num banco só com migrations não havia unidade de estado, ninguém ganhava
-- vínculo e a coordenação via "sem nome" nas outras pessoas) e `app.attach_active_members_to_state()` põe no estado
-- quem já estava ativo sem vínculo. Pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select is(
  (select count(*)::int from public.units u join public.unit_types t on t.id = u.type_id
   where t.key = 'state' and u.state_code ~ '^[A-Z]{2}$' and extensions.nlevel(u.path) = 2 and u.status = 'active'),
  27, 'as 27 unidades de estado existem, abaixo da raiz, ativas'
);
select is(
  (select name || '/' || slug || '/' || state_code from public.units where state_code = 'SP'),
  'São Paulo/sp/SP', 'o estado de São Paulo tem nome, slug e UF'
);
select is(
  (select count(distinct state_code)::int from public.units where state_code is not null),
  (select count(*)::int from public.units where state_code is not null), 'nenhuma UF repetida'
);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3');
create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000c1', pg_temp.enc('NomeUm'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000c2', pg_temp.enc('NomeDois'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000c3', pg_temp.enc('NomeTres'), 3550308, 'v1');
update public.profiles set access_status = 'active', status = 'active'
where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');
update public.profiles set access_status = 'waitlisted', status = 'active'
where id = '00000000-0000-0000-0000-0000000000c3';

select is(
  (select count(*)::int from public.unit_members where profile_id = '00000000-0000-0000-0000-0000000000c1' and left_at is null),
  1, 'com a unidade do estado criada pela migration, o gatilho já vincula quem completa o perfil'
);

-- Quem era do estado antes da migration: ativo, perfil completo e sem vínculo.
delete from public.unit_members where profile_id in
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3');
select is(app.attach_active_members_to_state(), 2, 'o conserto vincula as duas pessoas ativas e devolve a contagem');
select is(
  (select count(*)::int from public.unit_members m join public.units u on u.id = m.unit_id
   where m.left_at is null and u.state_code = 'SP'
     and m.profile_id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2')),
  2, 'cada uma entra no estado dela (SP)'
);
select is(
  (select count(*)::int from public.unit_members where profile_id = '00000000-0000-0000-0000-0000000000c3'),
  0, 'quem está em espera não é vinculado'
);
select is(
  (select item_count from public.audit_log where event = 'members_attached_to_state' order by id desc limit 1),
  2, 'a auditoria registra só a contagem'
);
select is(
  (select count(*)::int from public.audit_log where event = 'members_attached_to_state' and (actor_id is not null or target_id is not null)),
  0, 'o evento de sistema não cita ninguém'
);
select is(app.attach_active_members_to_state(), 0, 'repetir não faz nada (idempotente), e nenhum evento novo');

-- A coordenação nacional passa a ler o perfil de quem se cadastrou depois.
-- (Quem lê precisa ser membro ativo: termo atual aceito e casa aceita, ADR 0017.)
insert into public.consent_acceptances (user_id, version)
values ('00000000-0000-0000-0000-0000000000c1', app.current_consent_version());
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at)
values ('00000000-0000-0000-0000-0000000000c1', 'esparta', 'self', now() - interval '8 days', now() - interval '8 days');
insert into public.role_assignments (profile_id, role, unit_id)
select '00000000-0000-0000-0000-0000000000c1', 'manager', u.id from public.units u where u.path = 'br'::extensions.ltree;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
select is(
  (select display_name_enc from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'),
  pg_temp.enc('NomeDois'), 'a coordenação nacional lê o nome (cifrado) de outra pessoa ativa'
);

select * from finish();
rollback;
