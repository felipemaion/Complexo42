-- #130, parte 1: quem está em espera (`waitlisted`) também baixa os próprios dados (LGPD art. 18).
-- A RLS nega a essa pessoa quase toda leitura, mas `export_own_data()` é `security definer` e lê só as
-- linhas de `auth.uid()`: devolve o perfil dela, nada de ninguém mais, e grava `data_exported`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;
create function pg_temp.login(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version) values
  ('00000000-0000-0000-0000-0000000000b1', pg_temp.enc('NomeEspera'), 3550308, 'v1'),
  ('00000000-0000-0000-0000-0000000000b2', pg_temp.enc('NomeOutra'), 3550308, 'v1');
update public.profiles set access_status = 'waitlisted', status = 'active'
where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set access_status = 'active', status = 'active'
where id = '00000000-0000-0000-0000-0000000000b2';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
create temp table out_b1 on commit drop as select public.export_own_data() as d;
grant select on out_b1 to public;

select is((select d->'profile'->>'access_status' from out_b1), 'waitlisted', 'quem espera recebe o próprio perfil');
select is((select d->'profile'->>'display_name_enc' from out_b1), pg_temp.enc('NomeEspera'), 'o nome dela (cifrado)');
select ok(position('NomeOutra' in (select d::text from out_b1)) = 0, 'nada da outra pessoa');

reset role;
select is(
  (select count(*)::int from public.audit_log where event = 'data_exported' and actor_id = '00000000-0000-0000-0000-0000000000b1'),
  1, 'a exportação de quem espera grava data_exported'
);
select is(
  (select access_status from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'waitlisted', 'e a pessoa continua em espera: baixar não libera nada'
);

select * from finish();
rollback;
