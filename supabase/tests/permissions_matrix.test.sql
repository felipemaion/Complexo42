-- Matriz de permissões (ADR 0002, regra 4; AGENTS.md R16).
-- Parte 1: papel × alvo dentro/fora do escopo × operação, chamando as funções `app.can_*`
--          com o JWT de cada pessoa.
-- Parte 2: as mesmas regras vistas pelas tabelas, com o papel `authenticated` e a RLS ativa.
-- Todo PR que toca permissão acrescenta linhas aqui, com pelo menos um caso negado.
-- Árvore e pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

truncate public.role_assignments, public.unit_members, public.units;

-- ---------------------------------------------------------------------------------------
-- Árvore
--   br ─┬─ sp (SP) ─┬─ abc ─┬─ team_a
--       │           │       ├─ team_b
--       │           │       └─ house_1
--       │           └─ zl ──── team_c
--       └─ mg (MG) ──── central ── team_m
-- ---------------------------------------------------------------------------------------
create function pg_temp.unit(p_slug text) returns uuid language sql as $$
  select id from public.units where slug = p_slug
$$;
create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns void language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, pg_temp.unit(p_parent), p_slug, p_slug, p_state, p_slug::extensions.ltree
  from public.unit_types as t where t.key = p_type
$$;

select pg_temp.add_unit('national', null, 'br');
select pg_temp.add_unit('state', 'br', 'sp', 'SP');
select pg_temp.add_unit('state', 'br', 'mg', 'MG');
select pg_temp.add_unit('region', 'sp', 'abc');
select pg_temp.add_unit('region', 'sp', 'zl');
select pg_temp.add_unit('region', 'mg', 'central');
select pg_temp.add_unit('team', 'abc', 'team_a');
select pg_temp.add_unit('team', 'abc', 'team_b');
select pg_temp.add_unit('house', 'abc', 'house_1');
select pg_temp.add_unit('team', 'zl', 'team_c');
select pg_temp.add_unit('team', 'central', 'team_m');

-- ---------------------------------------------------------------------------------------
-- Pessoas (ids fictícios em auth.users)
-- ---------------------------------------------------------------------------------------
create temp table people (name text primary key, id uuid not null unique);
insert into people values
  ('nat_mgr',     '00000000-0000-0000-0000-000000000001'),  -- manager na raiz
  ('sp_mgr',      '00000000-0000-0000-0000-000000000002'),  -- manager em SP
  ('mg_mgr',      '00000000-0000-0000-0000-000000000003'),  -- manager em MG
  ('abc_mgr',     '00000000-0000-0000-0000-000000000004'),  -- coordenação regional do ABC
  ('team_a_mon',  '00000000-0000-0000-0000-000000000005'),  -- coordenador da equipe A
  ('house_mon',   '00000000-0000-0000-0000-000000000006'),  -- coordenador da casa 1
  ('tech',        '00000000-0000-0000-0000-000000000007'),  -- admin técnico
  ('spokes_a',    '00000000-0000-0000-0000-000000000008'),  -- porta-voz apoiado pela equipe A
  ('revoked_mgr', '00000000-0000-0000-0000-000000000009'),  -- ex-manager de MG (revogado)
  ('outsider',    '00000000-0000-0000-0000-00000000000a'),  -- logado, sem papel nem vínculo
  ('stu_a',       '00000000-0000-0000-0000-000000000010'),  -- membro da equipe A
  ('stu_b',       '00000000-0000-0000-0000-000000000011'),  -- membro da equipe B
  ('stu_c',       '00000000-0000-0000-0000-000000000012'),  -- membro da equipe C (outra região)
  ('stu_m',       '00000000-0000-0000-0000-000000000013'),  -- membro da equipe de MG
  ('stu_sp',      '00000000-0000-0000-0000-000000000014'),  -- só na unidade de SP
  ('stu_h',       '00000000-0000-0000-0000-000000000015'),  -- membro da casa 1
  ('stu_moved',   '00000000-0000-0000-0000-000000000016'),  -- saiu da equipe A, foi para MG
  ('stu_gone',    '00000000-0000-0000-0000-000000000017'),  -- saiu da equipe A, sem vínculo
  ('stu_wait',    '00000000-0000-0000-0000-000000000018'),  -- na equipe A, em lista de espera
  ('stu_blocked', '00000000-0000-0000-0000-000000000019');  -- na equipe A, bloqueado

insert into auth.users (id) select id from people;

-- Perfis (#10). Todos num município de teste sem unidade de estado, para o trigger de entrada
-- no estado não criar vínculos além dos desta matriz. Só `active` aparece para terceiros.
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ');
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3304557, 'v1' from people;
update public.profiles set access_status = 'active';
update public.profiles set access_status = 'waitlisted'
where id = '00000000-0000-0000-0000-000000000018';
update public.profiles set access_status = 'blocked'
where id = '00000000-0000-0000-0000-000000000019';

create function pg_temp.person(p_name text) returns uuid language sql as $$
  select id from people where name = p_name
$$;

insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('nat_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('sp')),
  (pg_temp.person('mg_mgr'), 'manager', pg_temp.unit('mg')),
  (pg_temp.person('abc_mgr'), 'manager', pg_temp.unit('abc')),
  (pg_temp.person('team_a_mon'), 'monitor', pg_temp.unit('team_a')),
  (pg_temp.person('house_mon'), 'monitor', pg_temp.unit('house_1')),
  (pg_temp.person('tech'), 'tech_admin', pg_temp.unit('br')),
  (pg_temp.person('spokes_a'), 'spokesperson', pg_temp.unit('team_a'));
insert into public.role_assignments (profile_id, role, unit_id, revoked_at) values
  (pg_temp.person('revoked_mgr'), 'manager', pg_temp.unit('mg'), now());

insert into public.unit_members (unit_id, profile_id, left_at) values
  (pg_temp.unit('team_a'), pg_temp.person('stu_a'), null),
  (pg_temp.unit('team_b'), pg_temp.person('stu_b'), null),
  (pg_temp.unit('team_c'), pg_temp.person('stu_c'), null),
  (pg_temp.unit('team_m'), pg_temp.person('stu_m'), null),
  (pg_temp.unit('sp'), pg_temp.person('stu_sp'), null),
  (pg_temp.unit('house_1'), pg_temp.person('stu_h'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_moved'), now()),
  (pg_temp.unit('team_m'), pg_temp.person('stu_moved'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_gone'), now()),
  (pg_temp.unit('team_a'), pg_temp.person('stu_wait'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_blocked'), null);

-- Contatos fictícios (formato válido; o banco não decifra nada).
insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
select id, 'v1.AAAAAAAAAAAAAAAA.CCCCCCCCCCCCCCCCCCCCCC', encode(sha256(id::text::bytea), 'hex')
from people where name in ('stu_a', 'stu_b', 'stu_wait', 'team_a_mon');

-- ---------------------------------------------------------------------------------------
-- Parte 1: matriz das funções
--   profile → app.can_view_profile   contact → app.can_view_contact
--   manage  → app.can_manage_unit    unit    → app.can_view_unit
--   edit    → app.can_edit_profile (criar/editar perfil e contato)
--   grant_<papel>     → app.can_grant_role('<papel>', unidade, outsider)
--   selfgrant_<papel> → app.can_grant_role('<papel>', unidade, o próprio ator)
-- ---------------------------------------------------------------------------------------
create temp table matrix (
  ord int generated always as identity,
  actor text, action text, target text, expected boolean
);
insert into matrix (actor, action, target, expected) values
  -- Gestor nacional: tudo, mas não concede no próprio nível nem tech_admin
  ('nat_mgr', 'profile', 'stu_a', true),
  ('nat_mgr', 'profile', 'stu_m', true),
  ('nat_mgr', 'contact', 'stu_c', true),
  ('nat_mgr', 'manage', 'br', true),
  ('nat_mgr', 'manage', 'team_m', true),
  ('nat_mgr', 'grant_manager', 'sp', true),
  ('nat_mgr', 'grant_monitor', 'team_a', true),
  ('nat_mgr', 'grant_manager', 'br', false),
  ('nat_mgr', 'grant_tech_admin', 'br', false),
  ('nat_mgr', 'grant_tech_admin', 'sp', false),
  ('nat_mgr', 'selfgrant_monitor', 'team_a', false),
  -- Gestor de SP: SP inteiro; MG não
  ('sp_mgr', 'profile', 'stu_a', true),
  ('sp_mgr', 'profile', 'stu_c', true),
  ('sp_mgr', 'profile', 'stu_sp', true),
  ('sp_mgr', 'contact', 'stu_a', true),
  ('sp_mgr', 'profile', 'stu_m', false),
  ('sp_mgr', 'contact', 'stu_m', false),
  ('sp_mgr', 'profile', 'stu_moved', false),
  ('sp_mgr', 'manage', 'sp', true),
  ('sp_mgr', 'manage', 'team_a', true),
  ('sp_mgr', 'manage', 'mg', false),
  ('sp_mgr', 'manage', 'team_m', false),
  ('sp_mgr', 'unit', 'br', true),
  ('sp_mgr', 'unit', 'mg', false),
  ('sp_mgr', 'grant_manager', 'abc', true),
  ('sp_mgr', 'grant_monitor', 'team_c', true),
  ('sp_mgr', 'grant_monitor', 'sp', false),
  ('sp_mgr', 'grant_manager', 'br', false),
  ('sp_mgr', 'grant_monitor', 'team_m', false),
  ('sp_mgr', 'selfgrant_manager', 'abc', false),
  -- Gestor de MG: MG inteiro; SP não
  ('mg_mgr', 'profile', 'stu_m', true),
  ('mg_mgr', 'profile', 'stu_moved', true),
  ('mg_mgr', 'profile', 'stu_a', false),
  ('mg_mgr', 'profile', 'stu_sp', false),
  ('mg_mgr', 'manage', 'sp', false),
  -- Coordenação regional do ABC: a região; outra região e o estado não
  ('abc_mgr', 'profile', 'stu_a', true),
  ('abc_mgr', 'profile', 'stu_b', true),
  ('abc_mgr', 'profile', 'stu_h', true),
  ('abc_mgr', 'contact', 'stu_b', true),
  ('abc_mgr', 'profile', 'stu_c', false),
  ('abc_mgr', 'contact', 'stu_c', false),
  ('abc_mgr', 'profile', 'stu_sp', false),
  ('abc_mgr', 'profile', 'stu_m', false),
  ('abc_mgr', 'manage', 'abc', true),
  ('abc_mgr', 'manage', 'team_b', true),
  ('abc_mgr', 'manage', 'zl', false),
  ('abc_mgr', 'manage', 'team_c', false),
  ('abc_mgr', 'manage', 'sp', false),
  ('abc_mgr', 'unit', 'sp', true),
  ('abc_mgr', 'unit', 'zl', false),
  ('abc_mgr', 'grant_monitor', 'team_a', true),
  ('abc_mgr', 'grant_spokesperson', 'team_a', true),
  ('abc_mgr', 'grant_monitor', 'abc', false),
  ('abc_mgr', 'grant_manager', 'zl', false),
  ('abc_mgr', 'grant_manager', 'sp', false),
  ('abc_mgr', 'selfgrant_monitor', 'team_a', false),
  -- Coordenador da equipe A: a equipe A; a equipe B não; monitor nunca concede
  ('team_a_mon', 'profile', 'stu_a', true),
  ('team_a_mon', 'contact', 'stu_a', true),
  ('team_a_mon', 'profile', 'stu_b', false),
  ('team_a_mon', 'contact', 'stu_b', false),
  ('team_a_mon', 'profile', 'stu_h', false),
  ('team_a_mon', 'profile', 'stu_c', false),
  ('team_a_mon', 'profile', 'stu_moved', false),
  ('team_a_mon', 'manage', 'team_a', true),
  ('team_a_mon', 'manage', 'team_b', false),
  ('team_a_mon', 'manage', 'abc', false),
  ('team_a_mon', 'unit', 'team_a', true),
  ('team_a_mon', 'unit', 'abc', true),
  ('team_a_mon', 'unit', 'team_b', false),
  ('team_a_mon', 'grant_monitor', 'team_a', false),
  ('team_a_mon', 'grant_monitor', 'team_b', false),
  ('team_a_mon', 'grant_spokesperson', 'team_a', false),
  -- Coordenador da casa 1: os membros da casa
  ('house_mon', 'profile', 'stu_h', true),
  ('house_mon', 'profile', 'stu_a', false),
  ('house_mon', 'manage', 'house_1', true),
  ('house_mon', 'manage', 'team_a', false),
  -- Porta-voz: vê o perfil da equipe que o apoia, não o contato; não gerencia nem concede
  ('spokes_a', 'profile', 'stu_a', true),
  ('spokes_a', 'contact', 'stu_a', false),
  ('spokes_a', 'profile', 'stu_b', false),
  ('spokes_a', 'manage', 'team_a', false),
  ('spokes_a', 'grant_monitor', 'team_a', false),
  -- Admin técnico: vê a estrutura, nenhum dado pessoal; não gerencia
  ('tech', 'profile', 'stu_a', false),
  ('tech', 'contact', 'stu_a', false),
  ('tech', 'profile', 'stu_m', false),
  ('tech', 'manage', 'br', false),
  ('tech', 'manage', 'team_a', false),
  ('tech', 'unit', 'team_a', true),
  ('tech', 'grant_manager', 'br', false),
  ('tech', 'grant_monitor', 'team_a', false),
  ('tech', 'selfgrant_manager', 'br', false),
  -- Papel revogado não vale
  ('revoked_mgr', 'profile', 'stu_m', false),
  ('revoked_mgr', 'manage', 'mg', false),
  ('revoked_mgr', 'grant_monitor', 'team_m', false),
  -- Membro sem papel: só a si mesmo e o caminho da sua unidade
  ('stu_a', 'profile', 'stu_a', true),
  ('stu_a', 'contact', 'stu_a', true),
  ('stu_a', 'profile', 'stu_b', false),
  ('stu_a', 'contact', 'stu_b', false),
  ('stu_a', 'manage', 'team_a', false),
  ('stu_a', 'unit', 'team_a', true),
  ('stu_a', 'unit', 'abc', true),
  ('stu_a', 'unit', 'team_b', false),
  ('stu_a', 'grant_monitor', 'team_a', false),
  ('stu_sp', 'unit', 'sp', true),
  ('stu_sp', 'unit', 'abc', false),
  -- Logado sem nada e visitante anônimo: nada
  ('outsider', 'profile', 'stu_a', false),
  ('outsider', 'contact', 'stu_a', false),
  ('outsider', 'manage', 'team_a', false),
  ('outsider', 'unit', 'br', false),
  ('outsider', 'grant_monitor', 'team_a', false),
  ('anon', 'profile', 'stu_a', false),
  ('anon', 'contact', 'stu_a', false),
  ('anon', 'manage', 'br', false),
  ('anon', 'unit', 'br', false),
  ('anon', 'grant_manager', 'br', false),
  -- Perfis (#10): só `active` aparece para terceiros; só o titular edita, e não se bloqueado
  ('team_a_mon', 'profile', 'stu_wait', false),
  ('team_a_mon', 'contact', 'stu_wait', false),
  ('team_a_mon', 'profile', 'stu_blocked', false),
  ('sp_mgr', 'profile', 'stu_wait', false),
  ('nat_mgr', 'profile', 'stu_wait', false),
  ('nat_mgr', 'contact', 'stu_blocked', false),
  ('stu_wait', 'profile', 'stu_wait', true),
  ('stu_wait', 'contact', 'stu_wait', true),
  ('stu_wait', 'profile', 'stu_a', false),
  ('stu_wait', 'edit', 'stu_wait', true),
  ('stu_blocked', 'profile', 'stu_blocked', true),
  ('stu_blocked', 'edit', 'stu_blocked', false),
  ('stu_a', 'edit', 'stu_a', true),
  ('stu_a', 'edit', 'stu_b', false),
  ('team_a_mon', 'edit', 'stu_a', false),
  ('sp_mgr', 'edit', 'stu_a', false),
  ('nat_mgr', 'edit', 'stu_a', false),
  ('tech', 'edit', 'stu_a', false),
  ('outsider', 'edit', 'stu_a', false),
  ('anon', 'edit', 'stu_a', false);

create function pg_temp.check_access(p_actor text, p_action text, p_target text)
returns boolean language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    case when p_actor = 'anon' then '{"role": "anon"}'
         else json_build_object('sub', pg_temp.person(p_actor), 'role', 'authenticated')::text
    end,
    true
  );
  return case
    when p_action = 'profile' then app.can_view_profile(pg_temp.person(p_target))
    when p_action = 'contact' then app.can_view_contact(pg_temp.person(p_target))
    when p_action = 'manage' then app.can_manage_unit(pg_temp.unit(p_target))
    when p_action = 'unit' then app.can_view_unit(pg_temp.unit(p_target))
    when p_action = 'edit' then app.can_edit_profile(pg_temp.person(p_target))
    when p_action like 'grant\_%' then
      app.can_grant_role(substr(p_action, 7), pg_temp.unit(p_target), pg_temp.person('outsider'))
    when p_action like 'selfgrant\_%' then
      app.can_grant_role(substr(p_action, 11), pg_temp.unit(p_target), pg_temp.person(p_actor))
  end;
end;
$$;

-- Troca de usuário para a parte 2 (RLS).
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people to authenticated;

select plan((select count(*)::int from matrix) + 61);

select is(
  pg_temp.check_access(actor, action, target),
  expected,
  format('%s × %s × %s → %s', actor, action, target,
         case when expected then 'permitido' else 'negado' end)
)
from matrix
order by ord;

reset request.jwt.claims;

-- ---------------------------------------------------------------------------------------
-- Parte 2: as tabelas com RLS
-- ---------------------------------------------------------------------------------------

-- Coordenador da equipe A
set local role authenticated;
select pg_temp.login('team_a_mon');

select set_eq(
  $$ select profile_id from public.unit_members $$,
  $$ select id from people
     where name in ('stu_a', 'stu_moved', 'stu_gone', 'stu_wait', 'stu_blocked') $$,
  'coordenador da equipe A lê os vínculos da equipe A (inclusive o histórico)'
);
select is_empty(
  $$ select 1 from public.unit_members where unit_id = pg_temp.unit('team_b') $$,
  'coordenador da equipe A NÃO lê os vínculos da equipe B'
);
select set_eq(
  $$ select slug from public.units $$,
  array['br', 'sp', 'abc', 'team_a'],
  'coordenador da equipe A vê a sua equipe e o caminho até a raiz, não as vizinhas'
);
select set_eq(
  $$ select profile_id from public.role_assignments $$,
  $$ select id from people where name in ('team_a_mon', 'spokes_a') $$,
  'coordenador da equipe A vê os papéis da sua equipe e os seus'
);
select lives_ok(
  $$ update public.unit_members set member_role = 'lead'
     where profile_id = pg_temp.person('stu_a') $$,
  'coordenador da equipe A edita vínculo da equipe A'
);
select lives_ok(
  $$ update public.unit_members set member_role = 'lead'
     where profile_id = pg_temp.person('stu_b') $$,
  'tentativa na equipe B não dá erro, mas não alcança linha nenhuma'
);
select lives_ok(
  $$ update public.units set name = 'Equipe A renomeada' where slug in ('team_a', 'team_b') $$,
  'coordenador da equipe A renomeia unidades (só a sua é alcançada)'
);
select throws_ok(
  $$ update public.units set parent_id = pg_temp.unit('zl') where slug = 'team_a' $$,
  '42501', null,
  'mover unidade não é permitido pela API'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('stu_a'), 'monitor', pg_temp.unit('team_a'),
             pg_temp.person('team_a_mon')) $$,
  '42501', null,
  'monitor não concede papel'
);
select throws_ok(
  $$ insert into public.unit_members (unit_id, profile_id)
     values (pg_temp.unit('team_a'), pg_temp.person('outsider')) $$,
  '42501', 'permission denied for table unit_members',
  'vínculo não é criado por INSERT direto (sem grant, não só pela RLS)'
);
select lives_ok(
  $$ update public.unit_members set left_at = null
     where profile_id = pg_temp.person('stu_gone') $$,
  'tentativa de reabrir vínculo encerrado não alcança linha nenhuma'
);
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where profile_id = pg_temp.person('spokes_a') $$,
  'monitor tenta revogar papel que não concedeu: não alcança linha nenhuma'
);

-- Coordenação regional do ABC
select pg_temp.login('abc_mgr');
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('outsider'), 'monitor', pg_temp.unit('team_c'),
             pg_temp.person('abc_mgr')) $$,
  '42501', null,
  'coordenação do ABC NÃO concede papel em outra região'
);

-- Gestor de SP
select pg_temp.login('sp_mgr');
select lives_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('outsider'), 'monitor', pg_temp.unit('team_c'),
             pg_temp.person('sp_mgr')) $$,
  'gestor de SP concede monitor numa equipe do estado'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('stu_c'), 'monitor', pg_temp.unit('team_c'),
             pg_temp.person('nat_mgr')) $$,
  '42501', null,
  'granted_by forjado é recusado'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('outsider'), 'monitor', pg_temp.unit('team_m'),
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'gestor de SP NÃO concede papel em MG'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('outsider'), 'manager', pg_temp.unit('sp'),
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'gestor de SP NÃO concede papel no próprio nível'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('sp_mgr'), 'monitor', pg_temp.unit('team_c'),
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'gestor de SP NÃO concede papel a si mesmo, nem numa unidade abaixo'
);
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where profile_id in (pg_temp.person('abc_mgr'), pg_temp.person('nat_mgr')) $$,
  'gestor de SP revoga papéis (só os abaixo dele são alcançados)'
);
select lives_ok(
  $$ update public.role_assignments set revoked_at = now() + interval '1 day'
     where profile_id = pg_temp.person('abc_mgr') $$,
  'tentativa de reescrever a data de um papel já revogado não alcança linha nenhuma'
);
select throws_ok(
  $$ update public.role_assignments set role = 'manager'
     where profile_id = pg_temp.person('outsider') $$,
  '42501', 'permission denied for table role_assignments',
  'role de um papel não muda por UPDATE'
);
select throws_ok(
  $$ update public.role_assignments set unit_id = pg_temp.unit('sp')
     where profile_id = pg_temp.person('outsider') $$,
  '42501', 'permission denied for table role_assignments',
  'unit_id de um papel não muda por UPDATE'
);
select throws_ok(
  $$ update public.role_assignments set profile_id = pg_temp.person('stu_c')
     where profile_id = pg_temp.person('outsider') $$,
  '42501', 'permission denied for table role_assignments',
  'profile_id de um papel não muda por UPDATE'
);
select throws_ok(
  $$ update public.role_assignments set granted_by = pg_temp.person('stu_c')
     where profile_id = pg_temp.person('outsider') $$,
  '42501', 'permission denied for table role_assignments',
  'granted_by de um papel não muda por UPDATE'
);
select throws_ok(
  $$ delete from public.role_assignments where profile_id = pg_temp.person('outsider') $$,
  '42501', null,
  'papel não é apagado, só revogado'
);

-- Membro sem papel
select pg_temp.login('stu_a');
select set_eq(
  $$ select profile_id from public.unit_members $$,
  array[pg_temp.person('stu_a')],
  'membro lê só o próprio vínculo'
);
select is_empty(
  $$ select 1 from public.role_assignments $$,
  'membro sem papel não lê papéis de ninguém'
);

-- Conferência como dono do banco (sem RLS)
reset role;
select results_eq(
  $$ select profile_id, member_role from public.unit_members
     where profile_id in (pg_temp.person('stu_a'), pg_temp.person('stu_b'))
     order by profile_id $$,
  $$ values (pg_temp.person('stu_a'), 'lead'), (pg_temp.person('stu_b'), 'member') $$,
  'só o vínculo da equipe A foi editado'
);
select set_eq(
  $$ select slug from public.units where name = 'Equipe A renomeada' $$,
  array['team_a'],
  'só a equipe A foi renomeada'
);
select results_eq(
  $$ select (select revoked_at is not null from public.role_assignments
             where profile_id = pg_temp.person('abc_mgr')),
            (select revoked_at is null from public.role_assignments
             where profile_id = pg_temp.person('nat_mgr')) $$,
  $$ values (true, true) $$,
  'o gestor de SP revogou o papel no ABC, mas não o do gestor nacional'
);
select is(
  (select revoked_at from public.role_assignments where profile_id = pg_temp.person('abc_mgr')),
  now(),
  'a data de revogação não foi reescrita'
);
select ok(
  (select left_at is not null from public.unit_members
   where profile_id = pg_temp.person('stu_gone')),
  'o vínculo encerrado não foi reaberto'
);
select ok(
  (select revoked_at is null from public.role_assignments
   where profile_id = pg_temp.person('spokes_a')),
  'o papel do porta-voz não foi revogado pelo monitor'
);

-- Admin técnico: estrutura sim, dado pessoal não
set local role authenticated;
select pg_temp.login('tech');
select is_empty(
  $$ select 1 from public.unit_members $$,
  'admin técnico NÃO lê vínculos de ninguém'
);
select set_eq(
  $$ select profile_id from public.role_assignments $$,
  array[pg_temp.person('tech')],
  'admin técnico lê só o próprio papel'
);
select is(
  (select count(*)::int from public.units),
  11,
  'admin técnico vê a estrutura inteira (sem dado pessoal)'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('outsider'), 'manager', pg_temp.unit('br'),
             pg_temp.person('tech')) $$,
  '42501', null,
  'admin técnico NÃO cria gestor nacional quando já existe um'
);

-- Sem gestor nacional ativo, o admin técnico cria o primeiro (e só um), nunca para si.
reset role;
update public.role_assignments set revoked_at = now()
where profile_id = pg_temp.person('nat_mgr');
set local role authenticated;
select pg_temp.login('tech');
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     select (select auth.uid()), 'manager', id, (select auth.uid())
     from public.units where slug = 'br' $$,
  '42501', null,
  'admin técnico NÃO concede a si mesmo o papel de gestor nacional'
);
select lives_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('outsider'), 'manager', pg_temp.unit('br'),
             pg_temp.person('tech')) $$,
  'admin técnico cria o primeiro gestor nacional'
);

-- O trigger de bootstrap recusa um 2º manager da raiz pela API mesmo sem a RLS (é ele que
-- serializa dois INSERTs simultâneos; aqui o dono do banco pula a política).
reset role;
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('stu_c'), 'manager', pg_temp.unit('br'),
             pg_temp.person('tech')) $$,
  '42501', 'a raiz já tem um manager ativo',
  'trigger recusa segundo gestor nacional criado pela API'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'role_assignments_root_bootstrap'
          and tgrelid = 'public.role_assignments'::regclass),
  'trigger de bootstrap da raiz instalado'
);

-- Quem concedeu revoga o que concedeu, mesmo na raiz.
set local role authenticated;
select pg_temp.login('tech');
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where profile_id = pg_temp.person('outsider') and role = 'manager' $$,
  'admin técnico revoga o gestor nacional que ele mesmo concedeu'
);
-- Gestor de MG não revoga o que o gestor de SP concedeu em SP.
select pg_temp.login('mg_mgr');
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where profile_id = pg_temp.person('outsider') and role = 'monitor' $$,
  'gestor de MG tenta revogar papel em SP: não alcança linha nenhuma'
);
reset role;
select results_eq(
  $$ select role, revoked_at is not null from public.role_assignments
     where profile_id = pg_temp.person('outsider') order by role $$,
  $$ values ('manager', true), ('monitor', false) $$,
  'o gestor nacional foi revogado por quem concedeu; o monitor de SP continua'
);

-- Perfis e contatos pela RLS (#10)
reset role;
set local role authenticated;
select pg_temp.login('team_a_mon');
select set_eq(
  $$ select id from public.profiles $$,
  $$ select id from people where name in ('team_a_mon', 'stu_a') $$,
  'coordenador da equipe A lê o próprio perfil e os ativos da equipe (não espera, bloqueado nem ex-membros)'
);
select set_eq(
  $$ select profile_id from public.profile_contacts $$,
  $$ select id from people where name in ('team_a_mon', 'stu_a') $$,
  'coordenador da equipe A lê o próprio contato e os da equipe, NÃO o de quem está na espera'
);
select is_empty(
  $$ select 1 from public.profiles where id = pg_temp.person('stu_b') $$,
  'coordenador da equipe A NÃO lê perfil da equipe B'
);
select lives_ok(
  $$ update public.profiles set district = 'Centro' where id = pg_temp.person('stu_a') $$,
  'coordenador tenta editar perfil de membro: não alcança linha nenhuma'
);
select lives_ok(
  $$ update public.profile_contacts set social_links_enc = whatsapp_enc
     where profile_id = pg_temp.person('stu_a') $$,
  'coordenador tenta editar contato de membro: não alcança linha nenhuma'
);

select pg_temp.login('spokes_a');
select set_eq(
  $$ select id from public.profiles $$,
  $$ select id from people where name in ('spokes_a', 'stu_a') $$,
  'porta-voz lê os perfis ativos da equipe que o apoia'
);
select is_empty(
  $$ select 1 from public.profile_contacts $$,
  'porta-voz NÃO lê contatos'
);

select pg_temp.login('sp_mgr');
select set_eq(
  $$ select id from public.profiles $$,
  $$ select id from people
     where name in ('sp_mgr', 'stu_a', 'stu_b', 'stu_c', 'stu_sp', 'stu_h') $$,
  'gestor de SP lê os perfis ativos de SP; NÃO os de MG nem os da espera'
);

select pg_temp.login('tech');
select set_eq(
  $$ select id from public.profiles $$,
  array[pg_temp.person('tech')],
  'admin técnico lê só o próprio perfil'
);
select is_empty(
  $$ select 1 from public.profile_contacts $$,
  'admin técnico NÃO lê contatos'
);

select pg_temp.login('stu_a');
select set_eq(
  $$ select id from public.profiles $$,
  array[pg_temp.person('stu_a')],
  'membro lê só o próprio perfil (NÃO o dos colegas)'
);
select set_eq(
  $$ select profile_id from public.profile_contacts $$,
  array[pg_temp.person('stu_a')],
  'membro lê só o próprio contato'
);

select pg_temp.login('stu_wait');
select set_eq(
  $$ select id from public.profiles $$,
  array[pg_temp.person('stu_wait')],
  'quem está na espera lê só o próprio perfil'
);

reset role;
select results_eq(
  $$ select district, (select social_links_enc from public.profile_contacts
                       where profile_id = pg_temp.person('stu_a'))
     from public.profiles where id = pg_temp.person('stu_a') $$,
  $$ values (null::text, null::text) $$,
  'perfil e contato do membro não foram alterados pelo coordenador'
);

-- Visitante anônimo
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok(
  $$ select 1 from public.units $$,
  '42501', null,
  'visitante anônimo não lê unidades'
);
select throws_ok(
  $$ select 1 from public.profiles $$,
  '42501', null,
  'visitante anônimo não lê perfis'
);
select throws_ok(
  $$ select 1 from public.profile_contacts $$,
  '42501', null,
  'visitante anônimo não lê contatos'
);

reset role;
select * from finish();
rollback;
