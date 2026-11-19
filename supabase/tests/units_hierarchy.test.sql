-- Estrutura da hierarquia (issue #46): ltree, `path` mantido por trigger, regras da árvore,
-- vínculos, papéis e a entrada automática na unidade do estado.
-- Tudo roda numa transação desfeita no fim; a árvore do seed é apagada só aqui dentro.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

truncate public.role_assignments, public.unit_members, public.house_members, public.units;

-- Este arquivo não troca de papel (roda todo como dono do banco), então a busca pode ser
-- feita na hora: os caminhos mudam quando a árvore é movida. Caminho desconhecido falha
-- (P0002) em vez de devolver nulo; `null` continua valendo "sem pai" (#113).
create function pg_temp.unit(p_path text) returns uuid language plpgsql as $$
declare
  found_id uuid;
begin
  if p_path is null then
    return null;
  end if;
  select id into found_id from public.units where path = p_path::extensions.ltree;
  if found_id is null then
    raise exception 'unidade de teste desconhecida: %', p_path using errcode = 'no_data_found';
  end if;
  return found_id;
end;
$$;
create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns uuid language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, pg_temp.unit(p_parent), p_slug, upper(p_slug), p_state, 'ignorado'
  from public.unit_types as t where t.key = p_type
  returning id
$$;

-- ---------------------------------------------------------------------------------------
-- ltree e índices
-- ---------------------------------------------------------------------------------------
select is(
  (select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'ltree'),
  'extensions',
  'ltree está instalada no schema extensions'
);
select ok(
  has_schema_privilege('anon', 'extensions', 'usage')
  and has_schema_privilege('authenticated', 'extensions', 'usage')
  and has_schema_privilege('service_role', 'extensions', 'usage'),
  'os papéis da API usam o schema extensions (tipos e operadores da ltree)'
);
select ok(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'units_path_gist'
            and indexdef ilike '%using gist (path)%'),
  'units.path tem índice GiST'
);

-- ---------------------------------------------------------------------------------------
-- path a partir de parent_id
-- ---------------------------------------------------------------------------------------
select pg_temp.add_unit('national', null, 'br');
select pg_temp.add_unit('state', 'br', 'sp', 'SP');
select pg_temp.add_unit('state', 'br', 'mg', 'MG');
select pg_temp.add_unit('region', 'br.sp', 'abc');
select pg_temp.add_unit('team', 'br.sp.abc', 'equipe_a');
select pg_temp.add_unit('team', 'br.sp.abc', 'equipe_b');

select set_eq(
  $$ select path::text from public.units $$,
  array['br', 'br.sp', 'br.mg', 'br.sp.abc', 'br.sp.abc.equipe_a', 'br.sp.abc.equipe_b'],
  'o trigger monta o path a partir do pai, ignorando o valor enviado'
);

update public.units set path = 'br.forjado' where slug = 'sp';
select is(
  (select path::text from public.units where slug = 'sp'),
  'br.sp',
  'path escrito à mão é recalculado'
);

update public.units set slug = 'sao_paulo' where slug = 'sp';
select set_eq(
  $$ select path::text from public.units where path <@ 'br.sao_paulo' $$,
  array['br.sao_paulo', 'br.sao_paulo.abc', 'br.sao_paulo.abc.equipe_a', 'br.sao_paulo.abc.equipe_b'],
  'trocar o slug reescreve o ramo inteiro'
);
update public.units set slug = 'sp' where slug = 'sao_paulo';

-- Mover a região de SP para MG leva junto tudo o que está abaixo dela.
update public.units set parent_id = pg_temp.unit('br.mg') where slug = 'abc';
select set_eq(
  $$ select path::text from public.units where path <@ 'br.mg' $$,
  array['br.mg', 'br.mg.abc', 'br.mg.abc.equipe_a', 'br.mg.abc.equipe_b'],
  'mover uma unidade move o ramo inteiro'
);
select is_empty(
  $$ select 1 from public.units where path <@ 'br.sp' and slug <> 'sp' $$,
  'nada do ramo movido fica no lugar antigo'
);
select isnt(
  current_setting('app.in_cascade', true),
  '1',
  'a flag da cascata é desligada ao fim do UPDATE do ramo'
);
update public.units set parent_id = pg_temp.unit('br.sp') where slug = 'abc';

-- ---------------------------------------------------------------------------------------
-- Regras da árvore
-- ---------------------------------------------------------------------------------------
select throws_ok(
  $$ update public.units set parent_id = pg_temp.unit('br.sp.abc.equipe_a') where slug = 'abc' $$,
  '23514', null,
  'uma unidade não pode ficar abaixo do próprio ramo (ciclo)'
);
select throws_ok(
  $$ select pg_temp.add_unit('team', 'br.sp.abc.equipe_a', 'sub') $$,
  '23514', null,
  'o tipo do filho precisa ter nível maior que o do pai'
);
select throws_ok(
  $$ select pg_temp.add_unit('state', null, 'solta') $$,
  '23514', null,
  'a raiz precisa ser de nível 0'
);
select throws_ok(
  $$ select pg_temp.add_unit('national', null, 'outra_raiz') $$,
  '23505', null,
  'só existe uma raiz'
);
select throws_ok(
  $$ select pg_temp.add_unit('region', 'br.sp', 'Com Espaço') $$,
  '23514', null,
  'slug fora do formato do ltree é recusado'
);
select throws_ok(
  $$ select pg_temp.add_unit('region', 'br.sp', 'abc') $$,
  '23505', null,
  'slug repetido no mesmo pai é recusado'
);
select throws_ok(
  $$ select pg_temp.add_unit('state', 'br', 'sp2', 'SP') $$,
  '23505', null,
  'só uma unidade de entrada por estado'
);
select throws_ok(
  $$ delete from public.units where slug = 'abc' $$,
  '23503', null,
  'unidade com filhos não é apagada'
);

-- ---------------------------------------------------------------------------------------
-- Vínculos e papéis
-- ---------------------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-0000000000a5');

-- Municípios de teste fora de SP (a migration só traz a região metropolitana de SP).
insert into public.municipalities (code, name, state_code) values
  (3106200, 'Belo Horizonte', 'MG'),
  (3304557, 'Rio de Janeiro', 'RJ');

-- Vínculos e papéis exigem perfil (#10). a1 e a2 moram num estado sem unidade, para o
-- trigger de entrada no estado não criar vínculo sozinho.
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id::uuid, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3304557, 'v1'
from unnest(array['00000000-0000-0000-0000-0000000000a1',
                  '00000000-0000-0000-0000-0000000000a2']) as id;

insert into public.unit_members (unit_id, profile_id)
values (pg_temp.unit('br.sp.abc.equipe_a'), '00000000-0000-0000-0000-0000000000a1');

-- Um vínculo de território aberto por pessoa; a casa é outro vínculo, em `house_members`
-- (ADR 0011), e não conta aqui.
select throws_ok(
  $$ insert into public.unit_members (unit_id, profile_id)
     values (pg_temp.unit('br.sp'), '00000000-0000-0000-0000-0000000000a1') $$,
  '23505', null,
  'uma pessoa tem um só vínculo de território aberto'
);
insert into public.houses (key) values ('casa-u1'), ('casa-u2') on conflict do nothing;
select lives_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, accepted_at)
     values ('00000000-0000-0000-0000-0000000000a1', 'casa-u1', 'self', now()) $$,
  'e, ao mesmo tempo, um vínculo de casa aberto'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, accepted_at)
     values ('00000000-0000-0000-0000-0000000000a1', 'casa-u2', 'self', now()) $$,
  '23505', null,
  'mas não duas casas abertas'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, accepted_at, consent_version)
     values ('00000000-0000-0000-0000-0000000000a2', 'casa-u1', 'self', now(), 'termo-exemplo-1') $$,
  '23514', null,
  'versão do termo só existe na casa pelo questionário'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, accepted_at)
     values ('00000000-0000-0000-0000-0000000000a2', 'casa-u1', 'questionnaire', now()) $$,
  '23514', null,
  'a casa pelo questionário exige a versão do termo'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method)
     values ('00000000-0000-0000-0000-0000000000a2', 'casa-inexistente', 'self') $$,
  '23503', null,
  'vínculo de casa só com casa que existe'
);
select throws_ok(
  $$ insert into public.houses (key) values ('Casa_Errada') $$,
  '23514', null,
  'a chave da casa segue o formato do id da config'
);
select hasnt_column('public', 'unit_members', 'axis', 'unit_members não tem mais eixo (ADR 0011)');
select hasnt_column('public', 'unit_types', 'membership_axis', 'unit_types não tem mais eixo (ADR 0011)');

update public.unit_members set left_at = now()
where profile_id = '00000000-0000-0000-0000-0000000000a1';
select lives_ok(
  $$ insert into public.unit_members (unit_id, profile_id)
     values (pg_temp.unit('br.sp'), '00000000-0000-0000-0000-0000000000a1') $$,
  'depois de encerrar o vínculo, a pessoa entra em outra unidade'
);
select is(
  (select count(*)::int from public.unit_members
   where profile_id = '00000000-0000-0000-0000-0000000000a1'),
  2,
  'o vínculo encerrado continua no histórico'
);
select throws_ok(
  $$ insert into public.unit_members (unit_id, profile_id, member_role)
     values (pg_temp.unit('br.sp'), '00000000-0000-0000-0000-0000000000a2', 'owner') $$,
  '23514', null,
  'member_role fora da lista é recusado'
);

select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id)
     values ('00000000-0000-0000-0000-0000000000a2', 'student', pg_temp.unit('br')) $$,
  '23514', null,
  'papel fora da lista é recusado'
);
insert into public.role_assignments (profile_id, role, unit_id)
values ('00000000-0000-0000-0000-0000000000a2', 'monitor', pg_temp.unit('br.sp.abc'));
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id)
     values ('00000000-0000-0000-0000-0000000000a2', 'monitor', pg_temp.unit('br.sp.abc')) $$,
  '23505', null,
  'o mesmo papel ativo não se repete na mesma unidade'
);

-- ---------------------------------------------------------------------------------------
-- Entrada automática na unidade do estado (trigger `profiles_join_state_unit`, #10)
-- ---------------------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_trigger where tgname = 'profiles_join_state_unit'
          and tgrelid = 'public.profiles'::regclass
          and tgfoid = 'app.tg_join_state_unit()'::regprocedure),
  'app.tg_join_state_unit está ligado à tabela profiles'
);

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
values ('00000000-0000-0000-0000-0000000000a3',
        'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1');
select results_eq(
  $$ select u.path::text from public.unit_members m join public.units u on u.id = m.unit_id
     where m.profile_id = '00000000-0000-0000-0000-0000000000a3' and m.left_at is null $$,
  array['br.sp'],
  'ao se cadastrar, a pessoa entra na unidade do seu estado'
);

update public.profiles set municipality_code = 3106200
where id = '00000000-0000-0000-0000-0000000000a3';
select results_eq(
  $$ select u.path::text from public.unit_members m join public.units u on u.id = m.unit_id
     where m.profile_id = '00000000-0000-0000-0000-0000000000a3' and m.left_at is null $$,
  array['br.mg'],
  'quem ainda está só no estado muda junto quando troca de estado'
);
select is(
  (select count(*)::int from public.unit_members
   where profile_id = '00000000-0000-0000-0000-0000000000a3' and left_at is not null),
  1,
  'o vínculo com o estado anterior é encerrado, não apagado'
);

-- Já matriculada numa equipe: trocar de estado não mexe (quem move é o gestor).
update public.unit_members set left_at = now()
where profile_id = '00000000-0000-0000-0000-0000000000a3' and left_at is null;
insert into public.unit_members (unit_id, profile_id)
values (pg_temp.unit('br.sp.abc.equipe_a'), '00000000-0000-0000-0000-0000000000a3');
update public.profiles set municipality_code = 3550308
where id = '00000000-0000-0000-0000-0000000000a3';
select results_eq(
  $$ select u.path::text from public.unit_members m join public.units u on u.id = m.unit_id
     where m.profile_id = '00000000-0000-0000-0000-0000000000a3' and m.left_at is null $$,
  array['br.sp.abc.equipe_a'],
  'quem já está numa equipe não é tirado dela pelo trigger'
);

insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
values ('00000000-0000-0000-0000-0000000000a4',
        'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3304557, 'v1');
select is_empty(
  $$ select 1 from public.unit_members
     where profile_id = '00000000-0000-0000-0000-0000000000a4' $$,
  'estado sem unidade: nenhum vínculo é criado'
);

-- Com uma casa aceita (ADR 0011): trocar de estado não mexe na casa.
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
values ('00000000-0000-0000-0000-0000000000a5',
        'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3550308, 'v1');
insert into public.house_members (profile_id, house_key, join_method, accepted_at)
values ('00000000-0000-0000-0000-0000000000a5', 'casa-u1', 'self', now());
update public.profiles set municipality_code = 3106200
where id = '00000000-0000-0000-0000-0000000000a5';
select set_eq(
  $$ select u.path::text from public.unit_members m join public.units u on u.id = m.unit_id
     where m.profile_id = '00000000-0000-0000-0000-0000000000a5' and m.left_at is null $$,
  array['br.mg'],
  'trocar de estado move o vínculo do estado'
);
select is(
  (select count(*)::int from public.house_members
   where profile_id = '00000000-0000-0000-0000-0000000000a5' and left_at is null),
  1,
  'e não encerra a casa'
);
select is(
  (select count(*)::int from public.unit_members
   where profile_id = '00000000-0000-0000-0000-0000000000a5' and left_at is not null),
  1,
  'só o vínculo do estado anterior foi encerrado'
);

-- ---------------------------------------------------------------------------------------
-- Privilégios: anon não toca nas tabelas; ninguém apaga pela API
-- ---------------------------------------------------------------------------------------
select ok(
  not has_table_privilege('anon', 'public.units', 'select')
  and not has_table_privilege('anon', 'public.unit_types', 'select')
  and not has_table_privilege('anon', 'public.unit_members', 'select')
  and not has_table_privilege('anon', 'public.role_assignments', 'select'),
  'visitante anônimo não tem acesso às tabelas da hierarquia'
);
select ok(
  not has_table_privilege('authenticated', 'public.units', 'delete')
  and not has_table_privilege('authenticated', 'public.unit_members', 'delete')
  and not has_table_privilege('authenticated', 'public.role_assignments', 'delete')
  and not has_table_privilege('authenticated', 'public.unit_types', 'insert'),
  'nenhum DELETE pela API e unit_types só leitura'
);
select ok(
  not has_column_privilege('authenticated', 'public.units', 'parent_id', 'update')
  and not has_column_privilege('authenticated', 'public.role_assignments', 'unit_id', 'update')
  and not has_column_privilege('authenticated', 'public.role_assignments', 'granted_at', 'insert'),
  'a API não move unidades nem altera o escopo ou a data de um papel'
);
select ok(
  not has_function_privilege('anon', 'app.can_view_profile(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.tg_join_state_unit()', 'execute'),
  'funções de acesso fechadas para anon; função de trigger fechada para a API'
);

select * from finish();
rollback;
