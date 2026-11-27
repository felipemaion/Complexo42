-- Migration do distrito por código (#175): o bloco de guarda de
-- `..._profile_district_code.sql` aborta quando um perfil tem nome de distrito sem código, em vez de
-- a coluna ser apagada com o dado. O bloco abaixo é cópia exata do da migration (um teste Vitest,
-- tests/localities-sql.test.ts, confere que são iguais). Tudo dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

-- Recria o estado de antes da migration: a coluna antiga existe.
alter table public.profiles add column district text;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
values ('00000000-0000-0000-0000-0000000000d1', 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'none');

select lives_ok($test$
-- guard:start
do $$
begin
  if exists (select 1 from public.profiles where district is not null and district_code is null) then
    raise exception 'district_migration_incomplete: perfil com distrito sem código; corrija antes de migrar'
      using errcode = 'data_exception';
  end if;
end
$$;
-- guard:end
$test$, 'sem perfil com distrito sem código, a migração segue');

update public.profiles set district = 'Distrito Que Não Existe';

select throws_ok($test$
-- guard:start
do $$
begin
  if exists (select 1 from public.profiles where district is not null and district_code is null) then
    raise exception 'district_migration_incomplete: perfil com distrito sem código; corrija antes de migrar'
      using errcode = 'data_exception';
  end if;
end
$$;
-- guard:end
$test$, '22000', 'district_migration_incomplete: perfil com distrito sem código; corrija antes de migrar',
  'nome de distrito que não virou código ABORTA a migração (nada é apagado)');

select is(
  (select district from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'),
  'Distrito Que Não Existe',
  'o dado continua na coluna antiga');

select * from finish();
rollback;
