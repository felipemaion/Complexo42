-- Matriz de permissões (ADR 0002, regra 4; AGENTS.md R16).
-- Parte 1: papel × alvo dentro/fora do escopo × operação, chamando as funções `app.can_*`
--          com o JWT de cada pessoa.
-- Parte 2: as mesmas regras vistas pelas tabelas, com o papel `authenticated` e a RLS ativa.
-- Todo PR que toca permissão acrescenta linhas aqui, com pelo menos um caso negado.
-- Árvore e pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

truncate public.questionnaire_data_grants, public.role_assignments, public.unit_members, public.house_members, public.units;

-- ---------------------------------------------------------------------------------------
-- Árvore
--   br ─┬─ sp (SP) ─┬─ abc ─┬─ team_a
--       │           │       └─ team_b
--       │           └─ zl ──── team_c
--       └─ mg (MG) ──── central ──── team_m
-- Casas nacionais (ADR 0011), fora da árvore: casa-t1, casa-t2 e casa-off (inativa).
-- ---------------------------------------------------------------------------------------
create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns void language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, (select u.id from public.units as u where u.slug = p_parent), p_slug, p_slug,
         p_state, p_slug::extensions.ltree
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
select pg_temp.add_unit('team', 'zl', 'team_c');
select pg_temp.add_unit('team', 'central', 'team_m');

insert into public.houses (key, active) values
  ('casa-t1', true), ('casa-t2', true), ('casa-off', false)
on conflict (key) do update set active = excluded.active;

-- Ids das unidades lidos aqui, como dono do banco, ANTES de qualquer troca de papel (#113).
-- Depois de `set local role authenticated`, uma consulta a `public.units` passa pela RLS: a
-- unidade fora do escopo viria nula e o teste negaria o acesso pelo motivo errado. O helper
-- lê só desta tabela e falha (P0002) com nome desconhecido, em vez de devolver nulo.
create temp table unit_ids (slug text primary key, id uuid not null unique);
insert into unit_ids select slug, id from public.units;
grant select on unit_ids to authenticated;
create function pg_temp.unit(p_slug text) returns uuid language plpgsql stable as $$
declare
  found_id uuid;
begin
  select id into found_id from unit_ids where slug = p_slug;
  if found_id is null then
    raise exception 'unidade de teste desconhecida: %', p_slug using errcode = 'no_data_found';
  end if;
  return found_id;
end;
$$;

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
  ('house_mon',   '00000000-0000-0000-0000-000000000006'),  -- coordenador da casa 1 no ABC (regional)
  ('tech',        '00000000-0000-0000-0000-000000000007'),  -- admin técnico
  ('spokes_a',    '00000000-0000-0000-0000-000000000008'),  -- porta-voz apoiado pela equipe A
  ('revoked_mgr', '00000000-0000-0000-0000-000000000009'),  -- ex-manager de MG (revogado)
  ('outsider',    '00000000-0000-0000-0000-00000000000a'),  -- logado, sem papel nem vínculo
  ('stu_a',       '00000000-0000-0000-0000-000000000010'),  -- membro da equipe A
  ('stu_b',       '00000000-0000-0000-0000-000000000011'),  -- membro da equipe B
  ('stu_c',       '00000000-0000-0000-0000-000000000012'),  -- membro da equipe C (outra região)
  ('stu_m',       '00000000-0000-0000-0000-000000000013'),  -- membro da equipe de MG
  ('stu_sp',      '00000000-0000-0000-0000-000000000014'),  -- só na unidade de SP
  ('stu_h',       '00000000-0000-0000-0000-000000000015'),  -- casa 1 (aceita hoje), sem território
  ('stu_moved',   '00000000-0000-0000-0000-000000000016'),  -- saiu da equipe A, foi para MG
  ('stu_gone',    '00000000-0000-0000-0000-000000000017'),  -- saiu da equipe A, sem vínculo
  ('stu_wait',    '00000000-0000-0000-0000-000000000018'),  -- na equipe A, em lista de espera
  ('stu_blocked', '00000000-0000-0000-0000-000000000019'),  -- na equipe A, bloqueado
  ('mon_wait',    '00000000-0000-0000-0000-00000000001a'),  -- monitor de SP, mas na espera
  ('mon_susp',    '00000000-0000-0000-0000-00000000001b'),  -- monitor da equipe B, suspenso
  ('stu_pend',    '00000000-0000-0000-0000-00000000001c'),  -- na equipe A, ainda pendente
  ('stu_susp',    '00000000-0000-0000-0000-00000000001d'),  -- na equipe A, conta suspensa
  ('tech_wait',   '00000000-0000-0000-0000-00000000001e'),  -- admin técnico, mas na espera
  ('nat_mon',     '00000000-0000-0000-0000-00000000001f'),  -- monitor na raiz (monitor nunca concede)
  ('tech_rev',    '00000000-0000-0000-0000-000000000020'),  -- ex-admin técnico (revogado)
  ('wait_moved',  '00000000-0000-0000-0000-000000000021'),  -- na espera; saiu da equipe A, foi para MG
  -- Casas (ADR 0011): vínculo de casa nacional (`house_members`); sem aceite, não conta
  ('stu_ah',      '00000000-0000-0000-0000-000000000022'),  -- equipe A + casa 1 (aceita)
  ('stu_ah2',     '00000000-0000-0000-0000-000000000023'),  -- equipe A + casa 2 (aceita)
  ('stu_bh',      '00000000-0000-0000-0000-000000000024'),  -- equipe B + casa 1 (aceita)
  ('stu_hpend',   '00000000-0000-0000-0000-000000000025'),  -- equipe A + casa 1 SEM aceite
  ('stu_hleft',   '00000000-0000-0000-0000-000000000026'),  -- equipe C; saiu da casa 1
  ('stu_mh',      '00000000-0000-0000-0000-000000000027'),  -- equipe de MG + casa 1 (outro estado)
  ('house2_mon',  '00000000-0000-0000-0000-000000000028'),  -- coordenador da casa 2 no ABC
  ('wait_hpend',  '00000000-0000-0000-0000-000000000029'),  -- na espera; equipe de MG + casa 1 sem aceite
  ('wait_honly',  '00000000-0000-0000-0000-00000000002a'),  -- na espera; só casa 1 sem aceite
  ('house_sp',    '00000000-0000-0000-0000-00000000002b'),  -- coordenador da casa 1 em SP (estadual)
  ('house_nat',   '00000000-0000-0000-0000-00000000002c'),  -- coordenador da casa 1 na raiz (nacional)
  ('house_mg',    '00000000-0000-0000-0000-00000000002d'),  -- coordenador da casa 1 em MG
  ('house_rev',   '00000000-0000-0000-0000-00000000002e'),  -- ex-coordenador da casa 1 na raiz (revogado)
  ('house_wait',  '00000000-0000-0000-0000-00000000002f'),  -- coordenador da casa 1 na raiz, mas na espera
  ('stu_ch',      '00000000-0000-0000-0000-000000000030'),  -- equipe C (outra região de SP) + casa 1
  ('stu_hsusp',   '00000000-0000-0000-0000-000000000031'),  -- equipe A + casa 1, conta suspensa
  ('stu_hwait',   '00000000-0000-0000-0000-000000000032'),  -- equipe A + casa 1, na espera
  ('stu_hmoved',  '00000000-0000-0000-0000-000000000033'),  -- saiu da equipe A, foi para MG; casa 1
  ('root_mgr2',   '00000000-0000-0000-0000-000000000034'),  -- vira manager da raiz no fim (revogação, M1)
  ('gone_granter','00000000-0000-0000-0000-000000000035');  -- concede um coordenador nacional e exclui a conta

insert into auth.users (id) select id from people;

-- Perfis (#10). Todos num município de teste sem unidade de estado, para o trigger de entrada
-- no estado não criar vínculos além dos desta matriz. Só `active` aparece para terceiros.
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', 3304557, 'v1' from people;
update public.profiles set access_status = 'active', status = 'active'
where id not in ('00000000-0000-0000-0000-00000000001c');
update public.profiles set access_status = 'waitlisted'
where id in ('00000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-00000000001a',
             '00000000-0000-0000-0000-00000000001e');
update public.profiles set access_status = 'waitlisted'
where id in (select id from people
             where name in ('wait_moved', 'wait_hpend', 'wait_honly', 'house_wait', 'stu_hwait'));
update public.profiles set access_status = 'blocked'
where id = '00000000-0000-0000-0000-000000000019';
update public.profiles set status = 'suspended'
where id in ('00000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000001d',
             '00000000-0000-0000-0000-000000000031');

create function pg_temp.person(p_name text) returns uuid language plpgsql stable as $$
declare
  found_id uuid;
begin
  select id into found_id from people where name = p_name;
  if found_id is null then
    raise exception 'pessoa de teste desconhecida: %', p_name using errcode = 'no_data_found';
  end if;
  return found_id;
end;
$$;

insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('nat_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('sp')),
  (pg_temp.person('mg_mgr'), 'manager', pg_temp.unit('mg')),
  (pg_temp.person('abc_mgr'), 'manager', pg_temp.unit('abc')),
  (pg_temp.person('team_a_mon'), 'monitor', pg_temp.unit('team_a')),
  (pg_temp.person('tech'), 'tech_admin', pg_temp.unit('br')),
  (pg_temp.person('spokes_a'), 'spokesperson', pg_temp.unit('team_a')),
  (pg_temp.person('mon_wait'), 'monitor', pg_temp.unit('sp')),
  (pg_temp.person('mon_susp'), 'monitor', pg_temp.unit('team_b')),
  (pg_temp.person('tech_wait'), 'tech_admin', pg_temp.unit('br')),
  (pg_temp.person('nat_mon'), 'monitor', pg_temp.unit('br'));
-- Papel concedido por quem hoje está na espera (para o caso "revoga o que concedeu").
insert into public.role_assignments (profile_id, role, unit_id, granted_by) values
  (pg_temp.person('stu_m'), 'spokesperson', pg_temp.unit('team_m'), pg_temp.person('tech_wait'));
insert into public.role_assignments (profile_id, role, unit_id, revoked_at) values
  (pg_temp.person('revoked_mgr'), 'manager', pg_temp.unit('mg'), now()),
  (pg_temp.person('tech_rev'), 'tech_admin', pg_temp.unit('br'), now());
-- Coordenadores de casa (ADR 0011): casa + território, em vários níveis.
insert into public.role_assignments (profile_id, role, unit_id, house_key, revoked_at) values
  (pg_temp.person('house_mon'), 'house_coordinator', pg_temp.unit('abc'), 'casa-t1', null),
  (pg_temp.person('house2_mon'), 'house_coordinator', pg_temp.unit('abc'), 'casa-t2', null),
  (pg_temp.person('house_sp'), 'house_coordinator', pg_temp.unit('sp'), 'casa-t1', null),
  (pg_temp.person('house_nat'), 'house_coordinator', pg_temp.unit('br'), 'casa-t1', null),
  (pg_temp.person('house_mg'), 'house_coordinator', pg_temp.unit('mg'), 'casa-t1', null),
  (pg_temp.person('house_wait'), 'house_coordinator', pg_temp.unit('br'), 'casa-t1', null),
  (pg_temp.person('house_rev'), 'house_coordinator', pg_temp.unit('br'), 'casa-t1', now());

insert into public.unit_members (unit_id, profile_id, left_at) values
  (pg_temp.unit('team_a'), pg_temp.person('stu_a'), null),
  (pg_temp.unit('team_b'), pg_temp.person('stu_b'), null),
  (pg_temp.unit('team_c'), pg_temp.person('stu_c'), null),
  (pg_temp.unit('team_m'), pg_temp.person('stu_m'), null),
  (pg_temp.unit('sp'), pg_temp.person('stu_sp'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_moved'), now()),
  (pg_temp.unit('team_m'), pg_temp.person('stu_moved'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_gone'), now()),
  (pg_temp.unit('team_a'), pg_temp.person('stu_wait'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_blocked'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_pend'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_susp'), null),
  (pg_temp.unit('team_a'), pg_temp.person('wait_moved'), now()),
  (pg_temp.unit('team_m'), pg_temp.person('wait_moved'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_ah'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_ah2'), null),
  (pg_temp.unit('team_b'), pg_temp.person('stu_bh'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_hpend'), null),
  (pg_temp.unit('team_c'), pg_temp.person('stu_hleft'), null),
  (pg_temp.unit('team_m'), pg_temp.person('stu_mh'), null),
  (pg_temp.unit('team_m'), pg_temp.person('wait_hpend'), null),
  (pg_temp.unit('team_c'), pg_temp.person('stu_ch'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_hsusp'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_hwait'), null),
  (pg_temp.unit('team_a'), pg_temp.person('stu_hmoved'), now()),
  (pg_temp.unit('team_m'), pg_temp.person('stu_hmoved'), null);

-- Vínculos de casa (ADR 0011): nacionais, sem região; sem `accepted_at`, não contam.
insert into public.house_members (profile_id, house_key, join_method, accepted_at, left_at) values
  (pg_temp.person('stu_h'), 'casa-t1', 'self', now(), null),
  (pg_temp.person('stu_ah2'), 'casa-t2', 'self', now(), null),
  (pg_temp.person('stu_bh'), 'casa-t1', 'self', now(), null),
  (pg_temp.person('stu_hpend'), 'casa-t1', 'self', null, null),
  (pg_temp.person('stu_hleft'), 'casa-t1', 'self', now(), now()),
  (pg_temp.person('stu_mh'), 'casa-t1', 'self', now(), null),
  (pg_temp.person('stu_ch'), 'casa-t1', 'self', now(), null),
  (pg_temp.person('stu_hsusp'), 'casa-t1', 'self', now(), null),
  (pg_temp.person('stu_hwait'), 'casa-t1', 'self', now(), null),
  (pg_temp.person('stu_hmoved'), 'casa-t1', 'self', now(), null),
  (pg_temp.person('wait_hpend'), 'casa-t1', 'self', null, null),
  (pg_temp.person('wait_honly'), 'casa-t1', 'self', null, null);
insert into public.house_members (profile_id, house_key, join_method, accepted_at, consent_version)
values (pg_temp.person('stu_ah'), 'casa-t1', 'questionnaire', now(), 'termo-exemplo-1');
-- Contato entre colegas de casa (#119): só depois de 7 dias de casa aceita pelos dois.
update public.house_members set joined_at = now() - interval '8 days', accepted_at = now() - interval '8 days'
where profile_id in (pg_temp.person('stu_ah'), pg_temp.person('stu_bh'), pg_temp.person('stu_ah2'));
-- Histórico: stu_bh já foi da casa 2 (aceita e encerrada antes de entrar na casa 1).
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at, left_at)
values (pg_temp.person('stu_bh'), 'casa-t2', 'self', now() - interval '20 days',
        now() - interval '20 days', now() - interval '10 days');

-- A casa aberta de cada pessoa, lida como dono (a RLS esconderia a de terceiros).
create temp table house_of (name text primary key, house_key text not null);
insert into house_of
select p.name, h.house_key from people as p
join public.house_members as h on h.profile_id = p.id and h.left_at is null;
grant select on house_of to authenticated;

-- Eventos de casa (#132), gravados como dono: o aceite de casa (alvo = ator = a pessoa) e o
-- aceite do termo (sem alvo).
insert into public.audit_log (actor_id, event, target_id, reason, house_key)
select pg_temp.person(v.n), 'house_accepted', pg_temp.person(v.n), 'self', v.h
from (values ('stu_ah', 'casa-t1'), ('stu_ah2', 'casa-t2'), ('stu_bh', 'casa-t1'),
             ('stu_ch', 'casa-t1'), ('stu_hleft', 'casa-t1')) as v (n, h);
insert into public.audit_log (actor_id, event, term_version)
values (pg_temp.person('stu_ah'), 'questionnaire_consented', 'termo-exemplo-1'),
       (pg_temp.person('stu_bh'), 'questionnaire_consented', 'termo-exemplo-1');

-- Contatos fictícios (formato válido; o banco não decifra nada).
insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
select id, 'v1.AAAAAAAAAAAAAAAA.CCCCCCCCCCCCCCCCCCCCCC', encode(sha256(id::text::bytea), 'hex')
from people where name in ('stu_a', 'stu_b', 'stu_wait', 'stu_susp', 'team_a_mon',
                           'stu_ah', 'stu_bh', 'stu_ah2', 'stu_hpend');

-- Quem vê o contato (#119, ADR 0010): a escolha de cada pessoa, contato por contato. Sem linha
-- é `none` (stu_a e os demais).
insert into public.contact_visibility (profile_id, kind, scope)
select pg_temp.person(v.name), v.kind, v.scope
from (values
  ('stu_ah', 'whatsapp', 'team'), ('stu_ah', 'social', 'team_house'), ('stu_ah', 'email', 'none'),
  ('stu_bh', 'whatsapp', 'team_house'), ('stu_bh', 'email', 'team_house'),
  ('stu_hpend', 'whatsapp', 'team_house'),
  ('stu_moved', 'whatsapp', 'team'), ('stu_gone', 'whatsapp', 'team_house'),
  ('stu_hleft', 'whatsapp', 'team_house'),
  ('stu_wait', 'whatsapp', 'team_house'), ('stu_susp', 'whatsapp', 'team_house'),
  ('stu_blocked', 'whatsapp', 'team_house'), ('stu_pend', 'whatsapp', 'team_house')
) as v (name, kind, scope);

-- ---------------------------------------------------------------------------------------
-- Parte 1: matriz das funções
--   profile → app.can_view_profile
--   contact / contact_social / contact_email → app.can_view_contact(alvo, whatsapp/social/email)
--   manage  → app.can_manage_unit    unit    → app.can_view_unit
--   edit    → app.can_edit_profile (criar/editar perfil e contato)
--   import  → app.can_import_allowlist   decide → app.can_decide_access (fila de espera)
--   block / unblock → app.can_block_member / app.can_unblock_member (quem já entrou)
--   quest_data → app.can_read_questionnaire_data (totem e pedidos de análise, ADR 0014)
--   audit_import / audit_decision → app.can_read_audit (importação / decisão sobre o alvo)
--   grant_<papel>     → app.can_grant_role('<papel>', unidade, outsider)
--   selfgrant_<papel> → app.can_grant_role('<papel>', unidade, o próprio ator)
--   revoke     → app.can_revoke_role(unidade, concedido por outra pessoa: outsider)
--   revoke_own → app.can_revoke_role(unidade, concedido pelo próprio ator)
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
  ('abc_mgr', 'profile', 'stu_h', false),
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
  -- Coordenador da casa 1 no ABC (ADR 0011): os membros ATIVOS da casa 1, com vínculo aceito,
  -- cujo vínculo de território está no ABC ou abaixo, de qualquer equipe
  ('house_mon', 'profile', 'stu_ah', true),
  ('house_mon', 'contact', 'stu_ah', true),
  ('house_mon', 'profile', 'stu_bh', true),
  ('house_mon', 'contact', 'stu_bh', true),
  -- ... mas não: outra casa no mesmo território; a mesma casa fora do território (outra
  -- região, outro estado, sem território); casa sem aceite ou encerrada; quem não é da casa;
  -- quem não está ativo
  ('house_mon', 'profile', 'stu_ah2', false),
  ('house_mon', 'contact', 'stu_ah2', false),
  ('house_mon', 'profile', 'stu_ch', false),
  ('house_mon', 'contact', 'stu_ch', false),
  ('house_mon', 'profile', 'stu_mh', false),
  ('house_mon', 'profile', 'stu_h', false),
  ('house_mon', 'contact', 'stu_h', false),
  ('house_mon', 'profile', 'stu_hpend', false),
  ('house_mon', 'contact', 'stu_hpend', false),
  ('house_mon', 'profile', 'stu_hleft', false),
  ('house_mon', 'contact', 'stu_hleft', false),
  ('house_mon', 'profile', 'stu_a', false),
  ('house_mon', 'contact', 'stu_a', false),
  ('house_mon', 'profile', 'stu_hsusp', false),
  ('house_mon', 'contact', 'stu_hsusp', false),
  ('house_mon', 'profile', 'stu_hwait', false),
  ('house_mon', 'contact', 'stu_hwait', false),
  ('house_mon', 'profile', 'stu_hmoved', false),
  ('house_mon', 'contact', 'stu_hmoved', false),
  -- Não tem escopo territorial: não gerencia unidade, não decide acesso, não concede nem
  -- revoga; vê a estrutura do território (abaixo e o caminho até a raiz), sem dado pessoal
  ('house_mon', 'manage', 'abc', false),
  ('house_mon', 'manage', 'team_a', false),
  ('house_mon', 'unit', 'abc', true),
  ('house_mon', 'unit', 'team_a', true),
  ('house_mon', 'unit', 'sp', true),
  ('house_mon', 'unit', 'zl', false),
  ('house_mon', 'unit', 'team_c', false),
  ('house_mon', 'unit', 'mg', false),
  ('house_mon', 'decide', 'wait_hpend', false),
  ('house_mon', 'grant_monitor', 'team_a', false),
  ('house_mon', 'grant_house_coordinator', 'team_a', false),
  ('house_mon', 'revoke', 'team_a', false),
  ('house_mon', 'import', 'br', false),
  ('house_mon', 'audit_decision', 'stu_ah', false),
  -- Coordenador da casa 2 no mesmo território: só a casa 2
  ('house2_mon', 'profile', 'stu_ah2', true),
  ('house2_mon', 'contact', 'stu_ah2', true),
  ('house2_mon', 'profile', 'stu_ah', false),
  ('house2_mon', 'contact', 'stu_ah', false),
  ('house2_mon', 'profile', 'stu_bh', false),
  -- Coordenador da casa 1 em SP (estadual): as regiões do estado; MG não
  ('house_sp', 'profile', 'stu_ah', true),
  ('house_sp', 'profile', 'stu_ch', true),
  ('house_sp', 'contact', 'stu_ch', true),
  ('house_sp', 'profile', 'stu_mh', false),
  ('house_sp', 'contact', 'stu_mh', false),
  ('house_sp', 'profile', 'stu_ah2', false),
  ('house_sp', 'profile', 'stu_h', false),
  ('house_sp', 'profile', 'stu_hpend', false),
  ('house_sp', 'unit', 'zl', true),
  ('house_sp', 'unit', 'mg', false),
  ('house_sp', 'manage', 'sp', false),
  ('house_sp', 'grant_house_coordinator', 'abc', false),
  -- Coordenador da casa 1 na raiz (nacional): todo o país, só a casa 1
  ('house_nat', 'profile', 'stu_ah', true),
  ('house_nat', 'profile', 'stu_ch', true),
  ('house_nat', 'profile', 'stu_mh', true),
  ('house_nat', 'contact', 'stu_mh', true),
  ('house_nat', 'contact_email', 'stu_mh', true),
  ('house_nat', 'profile', 'stu_ah2', false),
  ('house_nat', 'contact', 'stu_ah2', false),
  ('house_nat', 'profile', 'stu_hpend', false),
  ('house_nat', 'profile', 'stu_hleft', false),
  ('house_nat', 'profile', 'stu_h', false),
  ('house_nat', 'profile', 'stu_hsusp', false),
  ('house_nat', 'profile', 'stu_hwait', false),
  ('house_nat', 'profile', 'wait_hpend', false),
  ('house_nat', 'profile', 'stu_a', false),
  ('house_nat', 'manage', 'br', false),
  ('house_nat', 'decide', 'wait_honly', false),
  ('house_nat', 'unit', 'team_m', true),
  ('house_nat', 'grant_house_coordinator', 'sp', false),
  ('house_nat', 'revoke', 'sp', false),
  -- Coordenador da casa 1 em MG: a mesma casa, outro território
  ('house_mg', 'profile', 'stu_mh', true),
  ('house_mg', 'profile', 'stu_hmoved', true),
  ('house_mg', 'profile', 'stu_ah', false),
  ('house_mg', 'contact', 'stu_ah', false),
  ('house_mg', 'unit', 'sp', false),
  -- Papel revogado, ou coordenador que não está ativo: nada
  ('house_rev', 'profile', 'stu_ah', false),
  ('house_rev', 'contact', 'stu_ah', false),
  ('house_rev', 'unit', 'br', false),
  ('house_wait', 'profile', 'stu_ah', false),
  ('house_wait', 'contact', 'stu_ah', false),
  ('house_wait', 'unit', 'br', false),
  -- Revogar o coordenador NACIONAL de casa (revisão do #141, M1): o manager ativo da raiz revoga,
  -- mesmo sem ter concedido; só esse papel, só na raiz
  ('nat_mgr', 'revoke_hc', 'br', true),
  ('nat_mgr', 'revoke_role_mgr', 'br', false),
  ('nat_mgr', 'revoke_role_mon', 'br', false),
  ('sp_mgr', 'revoke_hc', 'br', false),
  ('sp_mgr', 'revoke_hc', 'abc', true),
  ('sp_mgr', 'revoke_hc', 'sp', false),
  ('nat_mon', 'revoke_hc', 'br', false),
  ('house_nat', 'revoke_hc', 'br', false),
  ('mon_wait', 'revoke_hc', 'br', false),
  ('revoked_mgr', 'revoke_hc', 'br', false),
  ('tech', 'revoke_hc', 'br', false),
  -- Conceder o papel de coordenador de casa (ADR 0011 §5): manager estritamente acima do
  -- território, nunca a si mesmo; monitor, porta-voz e admin técnico não
  ('nat_mgr', 'grant_house_coordinator', 'sp', true),
  -- Exceção (PR #141): o manager ativo da raiz concede o coordenador NACIONAL de casa na raiz;
  -- só esse papel, só na raiz, nunca a si mesmo
  ('nat_mgr', 'grant_house_coordinator', 'br', true),
  ('nat_mgr', 'grant_monitor', 'br', false),
  ('nat_mgr', 'grant_spokesperson', 'br', false),
  ('nat_mgr', 'selfgrant_house_coordinator', 'br', false),
  ('nat_mon', 'grant_house_coordinator', 'br', false),
  ('mon_wait', 'grant_house_coordinator', 'br', false),
  ('mg_mgr', 'grant_house_coordinator', 'mg', false),
  ('abc_mgr', 'grant_house_coordinator', 'abc', false),
  ('sp_mgr', 'grant_house_coordinator', 'abc', true),
  ('sp_mgr', 'grant_house_coordinator', 'team_c', true),
  ('sp_mgr', 'grant_house_coordinator', 'sp', false),
  ('sp_mgr', 'grant_house_coordinator', 'central', false),
  ('sp_mgr', 'selfgrant_house_coordinator', 'abc', false),
  ('abc_mgr', 'grant_house_coordinator', 'team_a', true),
  ('abc_mgr', 'grant_house_coordinator', 'zl', false),
  ('team_a_mon', 'grant_house_coordinator', 'team_a', false),
  ('nat_mon', 'grant_house_coordinator', 'sp', false),
  ('spokes_a', 'grant_house_coordinator', 'team_a', false),
  ('tech', 'grant_house_coordinator', 'br', false),
  ('revoked_mgr', 'grant_house_coordinator', 'central', false),
  ('mon_wait', 'grant_house_coordinator', 'abc', false),
  -- A coordenação territorial vê os membros do seu território, qualquer que seja a casa (ou
  -- sem aceite); a casa sem território não entra no escopo de ninguém pelo território
  ('team_a_mon', 'profile', 'stu_ah', true),
  ('team_a_mon', 'profile', 'stu_ah2', true),
  ('team_a_mon', 'profile', 'stu_hpend', true),
  ('team_a_mon', 'contact', 'stu_hpend', true),
  ('team_a_mon', 'profile', 'stu_bh', false),
  ('mg_mgr', 'profile', 'stu_bh', false),
  ('abc_mgr', 'profile', 'stu_mh', false),
  ('abc_mgr', 'profile', 'stu_ch', false),
  ('sp_mgr', 'profile', 'stu_ch', true),
  ('nat_mgr', 'profile', 'stu_h', false),
  -- A casa não é mais unidade: não mostra unidade nenhuma à pessoa
  ('stu_h', 'unit', 'br', false),
  ('stu_hpend', 'unit', 'team_a', true),
  ('stu_ah', 'profile', 'stu_bh', false),
  -- Auditoria dos eventos de casa (#132): house_accepted dos membros, para o coordenador da
  -- casa do registro no território e para o gestor (manager) acima; a pessoa lê os próprios
  ('house_mon', 'audit_house', 'stu_ah', true),
  ('house_mon', 'audit_house', 'stu_bh', true),
  ('house_mon', 'audit_house_other', 'stu_ah', false),
  ('house_mon', 'audit_house', 'stu_ah2', false),
  ('house_mon', 'audit_house', 'stu_ch', false),
  ('house_mon', 'audit_house', 'stu_hsusp', false),
  ('house_mon', 'audit_house', 'stu_hwait', false),
  ('house_mon', 'audit_house', 'stu_hpend', false),
  ('house_mon', 'audit_terms', 'stu_ah', false),
  ('house2_mon', 'audit_house', 'stu_ah2', true),
  ('house2_mon', 'audit_house', 'stu_ah', false),
  ('house_sp', 'audit_house', 'stu_ch', true),
  ('house_sp', 'audit_house', 'stu_mh', false),
  ('house_nat', 'audit_house', 'stu_mh', true),
  ('house_rev', 'audit_house', 'stu_ah', false),
  ('house_wait', 'audit_house', 'stu_ah', false),
  ('abc_mgr', 'audit_house', 'stu_ah', true),
  ('abc_mgr', 'audit_house', 'stu_ah2', true),
  ('abc_mgr', 'audit_house_other', 'stu_ah', true),
  ('abc_mgr', 'audit_house', 'stu_ch', false),
  ('sp_mgr', 'audit_house', 'stu_ch', true),
  ('mg_mgr', 'audit_house', 'stu_ah', false),
  ('team_a_mon', 'audit_house', 'stu_ah', false),
  ('spokes_a', 'audit_house', 'stu_ah', false),
  ('tech', 'audit_house', 'stu_ah', false),
  ('stu_bh', 'audit_house', 'stu_ah', false),
  ('abc_mgr', 'audit_terms', 'stu_ah', false),
  ('stu_ah', 'audit_house', 'stu_ah', true),
  ('stu_ah', 'audit_terms', 'stu_ah', true),
  ('stu_bh', 'audit_terms', 'stu_ah', false),
  ('stu_hwait', 'audit_house', 'stu_hwait', false),
  ('stu_hwait', 'audit_terms', 'stu_hwait', false),
  ('anon', 'audit_house', 'stu_ah', false),
  -- Fila de espera: a casa sem aceite não dá escopo ao gestor; sem vínculo que conte, só a raiz
  ('abc_mgr', 'decide', 'wait_hpend', false),
  ('sp_mgr', 'decide', 'wait_hpend', false),
  ('mg_mgr', 'decide', 'wait_hpend', true),
  ('nat_mgr', 'decide', 'wait_honly', true),
  ('sp_mgr', 'decide', 'wait_honly', false),
  ('abc_mgr', 'decide', 'wait_honly', false),
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
  ('anon', 'edit', 'stu_a', false),
  -- Quem chama também precisa estar ativo (revisão do PR #112): papel de quem está na espera
  -- ou suspenso não vale; conta suspensa some para terceiros e não edita
  ('mon_wait', 'profile', 'stu_sp', false),
  ('mon_wait', 'contact', 'stu_sp', false),
  ('mon_wait', 'manage', 'sp', false),
  ('mon_wait', 'unit', 'sp', false),
  ('mon_wait', 'unit', 'br', false),
  ('mon_wait', 'profile', 'mon_wait', true),
  ('mon_susp', 'profile', 'stu_b', false),
  ('mon_susp', 'contact', 'stu_b', false),
  ('mon_susp', 'manage', 'team_b', false),
  ('mon_susp', 'unit', 'team_b', false),
  ('team_a_mon', 'profile', 'stu_susp', false),
  ('team_a_mon', 'contact', 'stu_susp', false),
  ('team_a_mon', 'profile', 'stu_pend', false),
  ('stu_susp', 'profile', 'stu_susp', true),
  ('stu_susp', 'edit', 'stu_susp', false),
  ('stu_pend', 'profile', 'stu_pend', true),
  ('stu_pend', 'edit', 'stu_pend', true),
  ('stu_pend', 'unit', 'team_a', false),
  ('stu_wait', 'unit', 'team_a', false),
  ('stu_blocked', 'unit', 'team_a', false),
  -- Lista de autorizados (#26): só o gestor da raiz importa
  ('nat_mgr', 'import', 'br', true),
  ('sp_mgr', 'import', 'br', false),
  ('abc_mgr', 'import', 'br', false),
  ('team_a_mon', 'import', 'br', false),
  ('tech', 'import', 'br', false),
  ('tech_wait', 'import', 'br', false),
  ('revoked_mgr', 'import', 'br', false),
  ('stu_wait', 'import', 'br', false),
  ('outsider', 'import', 'br', false),
  ('anon', 'import', 'br', false),
  -- Fila de espera (#26): o gestor com escopo sobre o vínculo de quem espera decide; sem
  -- vínculo, só o gestor da raiz; monitor, porta-voz e admin técnico não
  ('nat_mgr', 'decide', 'stu_wait', true),
  ('sp_mgr', 'decide', 'stu_wait', true),
  ('abc_mgr', 'decide', 'stu_wait', true),
  -- Totem e pedidos de análise (ADR 0014): só a coordenação nacional, sobre pessoa ativa
  ('nat_mgr', 'quest_data', 'stu_ah', true),
  ('nat_mgr', 'quest_data', 'stu_wait', false),
  ('sp_mgr', 'quest_data', 'stu_ah', false),
  ('abc_mgr', 'quest_data', 'stu_ah', false),
  ('house_nat', 'quest_data', 'stu_ah', false),
  ('stu_ah', 'quest_data', 'stu_ah', true),
  ('stu_ah', 'quest_data', 'stu_bh', false),
  ('mg_mgr', 'decide', 'stu_wait', false),
  ('team_a_mon', 'decide', 'stu_wait', false),
  ('house_mon', 'decide', 'stu_wait', false),
  ('spokes_a', 'decide', 'stu_wait', false),
  ('tech', 'decide', 'stu_wait', false),
  ('revoked_mgr', 'decide', 'stu_wait', false),
  ('mon_wait', 'decide', 'stu_wait', false),
  ('stu_a', 'decide', 'stu_wait', false),
  ('stu_wait', 'decide', 'stu_wait', false),
  ('outsider', 'decide', 'stu_wait', false),
  ('anon', 'decide', 'stu_wait', false),
  ('sp_mgr', 'decide', 'stu_a', false),
  ('sp_mgr', 'decide', 'stu_blocked', false),
  ('sp_mgr', 'decide', 'stu_pend', false),
  ('nat_mgr', 'decide', 'mon_wait', true),
  ('sp_mgr', 'decide', 'mon_wait', false),
  ('nat_mgr', 'decide', 'tech_wait', true),
  -- Auditoria (#26): importação só para o gestor da raiz; decisão, para o gestor no escopo
  ('nat_mgr', 'audit_import', 'br', true),
  ('sp_mgr', 'audit_import', 'br', false),
  ('tech', 'audit_import', 'br', false),
  ('sp_mgr', 'audit_decision', 'stu_wait', true),
  ('abc_mgr', 'audit_decision', 'stu_wait', true),
  ('mg_mgr', 'audit_decision', 'stu_wait', false),
  ('team_a_mon', 'audit_decision', 'stu_a', false),
  ('tech', 'audit_decision', 'stu_a', false),
  ('stu_a', 'audit_decision', 'stu_a', false),
  ('nat_mgr', 'audit_decision', 'nat_mgr', false),
  ('nat_mgr', 'decide', 'nat_mgr', false),
  ('anon', 'audit_decision', 'stu_wait', false),
  -- Checagem de mutação (#113): cada linha abaixo derruba uma guarda que antes não tinha teste
  -- Quem vê o contato (#119, ADR 0010). A coordenação vê qualquer tipo, sem depender da escolha
  ('team_a_mon', 'contact_email', 'stu_a', true),
  ('team_a_mon', 'contact_social', 'stu_ah', true),
  ('house_mon', 'contact_email', 'stu_bh', true),
  ('house_mon', 'contact_email', 'stu_ah2', false),
  ('sp_mgr', 'contact_email', 'stu_m', false),
  -- Colega de equipe: sem autorização não vê; com `team`, vê só aquele contato
  ('stu_ah', 'contact', 'stu_a', false),
  ('stu_ah', 'contact_email', 'stu_a', false),
  ('stu_a', 'contact', 'stu_ah', true),
  ('stu_a', 'contact_social', 'stu_ah', true),
  ('stu_a', 'contact_email', 'stu_ah', false),
  ('stu_hpend', 'contact', 'stu_ah', true),
  ('stu_a', 'contact', 'stu_hpend', true),
  -- Colega de casa: `team` não alcança a casa; `team_house` alcança, de qualquer equipe da
  -- mesma região, com os dois na casa há 7 dias ou mais (stu_h aceitou hoje e não tem equipe)
  ('stu_bh', 'contact', 'stu_ah', false),
  ('stu_h', 'contact', 'stu_ah', false),
  ('stu_bh', 'contact_social', 'stu_ah', true),
  ('stu_h', 'contact_social', 'stu_ah', false),
  ('stu_ah', 'contact', 'stu_bh', true),
  ('stu_h', 'contact_email', 'stu_bh', false),
  ('stu_bh', 'contact', 'stu_a', false),
  -- Outra casa e outra equipe: nada; casa sem aceite não conta (dos dois lados)
  ('stu_ah2', 'contact', 'stu_bh', false),
  ('stu_c', 'contact', 'stu_bh', false),
  ('stu_hpend', 'contact', 'stu_bh', false),
  ('stu_h', 'contact', 'stu_hpend', false),
  ('stu_bh', 'contact', 'stu_hpend', false),
  -- Ex-colega: o vínculo fechado deixa de valer na hora (equipe e casa)
  ('stu_a', 'contact', 'stu_moved', false),
  ('stu_m', 'contact', 'stu_moved', true),
  ('stu_a', 'contact', 'stu_gone', false),
  ('stu_moved', 'contact', 'stu_ah', false),
  ('stu_gone', 'contact_social', 'stu_ah', false),
  ('stu_h', 'contact', 'stu_hleft', false),
  ('stu_ah', 'contact', 'stu_hleft', false),
  ('stu_hleft', 'contact_social', 'stu_ah', false),
  -- Porta-voz e admin técnico: nem com a autorização da pessoa
  ('spokes_a', 'contact', 'stu_ah', false),
  ('spokes_a', 'contact_social', 'stu_bh', false),
  ('tech', 'contact', 'stu_bh', false),
  ('tech', 'contact_email', 'stu_bh', false),
  -- Quem não está ativo não vê nem é visto, mesmo autorizado
  ('stu_a', 'contact', 'stu_wait', false),
  ('stu_a', 'contact', 'stu_susp', false),
  ('stu_a', 'contact', 'stu_blocked', false),
  ('stu_a', 'contact', 'stu_pend', false),
  ('stu_wait', 'contact', 'stu_ah', false),
  ('stu_susp', 'contact', 'stu_ah', false),
  ('stu_blocked', 'contact', 'stu_ah', false),
  ('stu_pend', 'contact', 'stu_ah', false),
  ('wait_hpend', 'contact', 'stu_bh', false),
  -- O próprio vê todos os seus contatos; anônimo e logado sem vínculo, nenhum
  ('stu_a', 'contact_email', 'stu_a', true),
  ('stu_wait', 'contact_email', 'stu_wait', true),
  ('outsider', 'contact_social', 'stu_ah', false),
  ('anon', 'contact_email', 'stu_bh', false),
  -- Contato: vínculo encerrado não dá escopo
  ('team_a_mon', 'contact', 'stu_moved', false),
  ('sp_mgr', 'contact', 'stu_moved', false),
  ('mg_mgr', 'contact', 'stu_moved', true),
  -- Unidades: tech_admin revogado não vê a estrutura; vínculo encerrado não mostra a unidade
  ('tech_rev', 'unit', 'team_a', false),
  ('tech_rev', 'unit', 'br', false),
  ('stu_gone', 'unit', 'team_a', false),
  ('stu_moved', 'unit', 'team_a', false),
  ('stu_moved', 'unit', 'team_m', true),
  -- Monitor na raiz: vê e gerencia tudo, mas nunca concede, revoga, importa nem decide
  ('nat_mon', 'profile', 'stu_m', true),
  ('nat_mon', 'contact', 'stu_a', true),
  ('nat_mon', 'manage', 'sp', true),
  ('nat_mon', 'grant_monitor', 'team_a', false),
  ('nat_mon', 'grant_spokesperson', 'sp', false),
  ('nat_mon', 'revoke', 'sp', false),
  ('nat_mon', 'import', 'br', false),
  ('nat_mon', 'audit_import', 'br', false),
  ('nat_mon', 'decide', 'stu_wait', false),
  -- tech_admin só cria manager na raiz, nunca em outra unidade sem manager
  ('tech', 'grant_manager', 'team_a', false),
  -- Fila: o vínculo encerrado não dá escopo para decidir; vale o aberto
  ('sp_mgr', 'decide', 'wait_moved', false),
  ('abc_mgr', 'decide', 'wait_moved', false),
  ('sp_mgr', 'audit_decision', 'wait_moved', false),
  ('mg_mgr', 'decide', 'wait_moved', true),
  -- Revogar: só o que concedeu, ou manager estritamente acima e no mesmo ramo
  ('sp_mgr', 'revoke', 'team_a', true),
  ('nat_mgr', 'revoke', 'mg', true),
  ('tech', 'revoke_own', 'br', true),
  ('sp_mgr', 'revoke', 'sp', false),
  ('sp_mgr', 'revoke', 'team_m', false),
  ('abc_mgr', 'revoke', 'zl', false),
  ('team_a_mon', 'revoke', 'team_a', false),
  ('spokes_a', 'revoke', 'team_a', false),
  ('tech', 'revoke', 'team_a', false),
  ('revoked_mgr', 'revoke', 'team_m', false),
  ('stu_a', 'revoke', 'team_a', false),
  ('anon', 'revoke', 'team_a', false),
  -- Bloquear quem está ativo / desbloquear (#26): gestor no escopo, nunca a si nem quem tem
  -- papel no seu nível ou acima (o gestor da raiz alcança house_coordinator e tech_admin na
  -- raiz); só alvo ativo (bloquear) ou bloqueado (desbloquear)
  ('sp_mgr', 'block', 'stu_a', true),
  ('abc_mgr', 'block', 'stu_a', true),
  ('nat_mgr', 'block', 'stu_m', true),
  ('nat_mgr', 'block', 'sp_mgr', true),
  ('nat_mgr', 'block', 'spokes_a', true),
  ('mg_mgr', 'block', 'stu_a', false),
  ('abc_mgr', 'block', 'stu_c', false),
  ('sp_mgr', 'block', 'spokes_a', false),
  ('nat_mgr', 'block', 'tech', true),
  ('sp_mgr', 'block', 'house_sp', false),
  ('nat_mgr', 'block', 'house_sp', true),
  ('nat_mgr', 'block', 'tech_wait', false),
  ('nat_mgr', 'block', 'nat_mon', false),
  ('nat_mgr', 'block', 'house_nat', true),
  ('nat_mgr', 'block', 'nat_mgr', false),
  ('sp_mgr', 'block', 'sp_mgr', false),
  ('team_a_mon', 'block', 'stu_a', false),
  ('spokes_a', 'block', 'stu_a', false),
  ('house_mon', 'block', 'stu_ah', false),
  ('tech', 'block', 'stu_a', false),
  ('revoked_mgr', 'block', 'stu_m', false),
  ('mon_wait', 'block', 'stu_a', false),
  ('stu_a', 'block', 'stu_b', false),
  ('anon', 'block', 'stu_a', false),
  ('sp_mgr', 'block', 'stu_wait', false),
  ('sp_mgr', 'block', 'stu_blocked', false),
  ('sp_mgr', 'block', 'stu_pend', false),
  ('sp_mgr', 'unblock', 'stu_blocked', true),
  ('abc_mgr', 'unblock', 'stu_blocked', true),
  ('mg_mgr', 'unblock', 'stu_blocked', false),
  ('team_a_mon', 'unblock', 'stu_blocked', false),
  ('stu_blocked', 'unblock', 'stu_blocked', false),
  ('anon', 'unblock', 'stu_blocked', false),
  ('sp_mgr', 'unblock', 'stu_a', false),
  ('sp_mgr', 'unblock', 'stu_wait', false);

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
    when p_action = 'contact' then app.can_view_contact(pg_temp.person(p_target), 'whatsapp')
    when p_action = 'contact_social' then app.can_view_contact(pg_temp.person(p_target), 'social')
    when p_action = 'contact_email' then app.can_view_contact(pg_temp.person(p_target), 'email')
    when p_action = 'manage' then app.can_manage_unit(pg_temp.unit(p_target))
    when p_action = 'unit' then app.can_view_unit(pg_temp.unit(p_target))
    when p_action = 'edit' then app.can_edit_profile(pg_temp.person(p_target))
    when p_action = 'import' then app.can_import_allowlist()
    when p_action = 'decide' then app.can_decide_access(pg_temp.person(p_target))
    when p_action = 'block' then app.can_block_member(pg_temp.person(p_target))
    when p_action = 'unblock' then app.can_unblock_member(pg_temp.person(p_target))
    when p_action = 'quest_data' then app.can_read_questionnaire_data(pg_temp.person(p_target))
    when p_action = 'audit_import' then app.can_read_audit('allowlist_imported', null)
    when p_action = 'audit_decision' then
      app.can_read_audit('access_granted', pg_temp.person(p_target))
    -- house_accepted de outra pessoa (alvo e ator), com a casa aberta dela (lida como dono)
    when p_action = 'audit_house' then
      app.can_read_audit('house_accepted', pg_temp.person(p_target), pg_temp.person(p_target),
                         (select h.house_key from house_of as h where h.name = p_target))
    -- house_accepted de uma casa que não é a aberta da pessoa (histórico)
    when p_action = 'audit_house_other' then
      app.can_read_audit('house_accepted', pg_temp.person(p_target), pg_temp.person(p_target),
                         'casa-t2')
    -- questionnaire_consented (sem alvo) com `p_target` como ator
    when p_action = 'audit_terms' then
      app.can_read_audit('questionnaire_consented', null, pg_temp.person(p_target), null)
    when p_action like 'grant\_%' then
      app.can_grant_role(substr(p_action, 7), pg_temp.unit(p_target), pg_temp.person('outsider'))
    when p_action like 'selfgrant\_%' then
      app.can_grant_role(substr(p_action, 11), pg_temp.unit(p_target), pg_temp.person(p_actor))
    when p_action = 'revoke' then
      app.can_revoke_role(pg_temp.unit(p_target), pg_temp.person('outsider'))
    -- Revogar com o papel (revisão do #141, M1): concedido por outra pessoa (outsider)
    when p_action = 'revoke_hc' then
      app.can_revoke_role(pg_temp.unit(p_target), pg_temp.person('outsider'), 'house_coordinator')
    when p_action = 'revoke_role_mgr' then
      app.can_revoke_role(pg_temp.unit(p_target), pg_temp.person('outsider'), 'manager')
    when p_action = 'revoke_role_mon' then
      app.can_revoke_role(pg_temp.unit(p_target), pg_temp.person('outsider'), 'monitor')
    when p_action = 'revoke_own' then
      app.can_revoke_role(pg_temp.unit(p_target), pg_temp.person(p_actor))
  end;
end;
$$;

-- Troca de usuário para a parte 2 (RLS).
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
grant select on people to authenticated;

-- Todas as pessoas aceitaram o termo vigente (#11): `save_own_profile` exige o aceite.
insert into public.consent_acceptances (user_id, version) select id, 'v1' from auth.users;

select plan((select count(*)::int from matrix) + 156);

-- Nenhum id usado nos testes é nulo (#113): toda unidade e toda pessoa citada na matriz
-- existe nas tabelas lidas como dono, e as 10 unidades da árvore foram capturadas.
select is((select count(*)::int from unit_ids), 10, 'ids das 10 unidades lidos como dono do banco');
select is_empty(
  $$ select actor from matrix where actor <> 'anon' and actor not in (select name from people)
     union all
     select target from matrix
     where action in ('profile', 'contact', 'contact_social', 'contact_email', 'edit', 'decide',
                      'block', 'unblock',
                      'audit_decision', 'audit_house', 'audit_house_other', 'audit_terms')
       and target not in (select name from people)
     union all
     select target from matrix
     where (action in ('manage', 'unit', 'import', 'audit_import', 'revoke', 'revoke_own',
                       'revoke_hc', 'revoke_role_mgr', 'revoke_role_mon')
            or action like 'grant\_%' or action like 'selfgrant\_%')
       and target not in (select slug from unit_ids) $$,
  'toda pessoa e toda unidade citada na matriz tem id (nenhum id nulo)'
);
select is_empty(
  $$ select name from people where id is null
     union all select slug from unit_ids where id is null $$,
  'nenhum id de pessoa ou unidade é nulo'
);

select is(
  pg_temp.check_access(actor, action, target),
  expected,
  format('%s × %s × %s → %s', actor, action, target,
         case when expected then 'permitido' else 'negado' end)
)
from matrix
order by ord;

-- Casos de borda das funções (checagem de mutação, #113). O resultado tem que ser `false`,
-- não nulo: a RLS trata nulo como negado, mas quem chama a função pelo servidor não.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select is(app.can_read_municipalities(), false,
  'JWT sem `sub` (auth.uid() nulo) NÃO lê municípios');
select pg_temp.login('sp_mgr');
select is(app.can_grant_role('monitor', pg_temp.unit('team_a'), null), false,
  'conceder papel sem dizer a quem é negado (false, não nulo)');
select pg_temp.login('nat_mgr');
select is(app.manages_member(null), false,
  'gestor da raiz NÃO gerencia alvo nulo (false, não nulo)');
select pg_temp.login('tech');
select is_empty($$ select 1 from app.my_scopes() $$,
  'admin técnico não tem escopo de dados (my_scopes vazio)');
select is(app.is_house_coordinator_of(pg_temp.person('house_wait'), pg_temp.person('stu_ah')), false,
  'coordenador de casa que não está ativo NÃO coordena (a regra confere quem vê, não só quem chama)');

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
     where name in ('stu_a', 'stu_moved', 'stu_gone', 'stu_ah', 'stu_ah2', 'stu_hpend',
                    'stu_hmoved') $$,
  'coordenador da equipe A lê os vínculos de perfis ativos da equipe A (inclusive o histórico)'
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
  10,
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
select pg_temp.login('tech_wait');
select is(
  app.can_grant_role('manager', pg_temp.unit('br'), pg_temp.person('outsider')),
  false,
  'admin técnico na espera NÃO cria o gestor nacional'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('outsider'), 'manager', pg_temp.unit('br'),
             pg_temp.person('tech_wait')) $$,
  '42501', null,
  'admin técnico na espera NÃO insere o gestor nacional'
);
select is(
  app.can_revoke_role(pg_temp.unit('team_m'), pg_temp.person('tech_wait')),
  false,
  'quem está na espera NÃO revoga nem o papel que concedeu'
);
-- Sem manager na raiz, só o tech_admin ativo cria, e só o papel de manager.
select pg_temp.login('tech_rev');
select is(
  app.can_grant_role('manager', pg_temp.unit('br'), pg_temp.person('outsider')),
  false,
  'admin técnico revogado NÃO cria o gestor nacional'
);
select pg_temp.login('sp_mgr');
select is(
  app.can_grant_role('manager', pg_temp.unit('br'), pg_temp.person('outsider')),
  false,
  'gestor de SP NÃO cria o gestor nacional, nem com a raiz vaga'
);
select pg_temp.login('tech');
select is(
  app.can_grant_role('monitor', pg_temp.unit('br'), pg_temp.person('outsider')),
  false,
  'admin técnico NÃO concede monitor na raiz, nem com a raiz vaga'
);
select is(
  app.can_grant_role('spokesperson', pg_temp.unit('br'), pg_temp.person('outsider')),
  false,
  'admin técnico NÃO concede porta-voz na raiz, nem com a raiz vaga'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values ((select auth.uid()), 'manager', pg_temp.unit('br'), (select auth.uid())) $$,
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
  $$ select id from people
     where name in ('team_a_mon', 'stu_a', 'stu_ah', 'stu_ah2', 'stu_hpend') $$,
  'coordenador da equipe A lê o próprio perfil e os ativos da equipe (não espera, bloqueado nem ex-membros)'
);
select set_eq(
  $$ select profile_id from public.profile_contacts $$,
  array[pg_temp.person('team_a_mon')],
  'coordenador da equipe A lê pela tabela só o próprio contato (o dos outros, só por view_contact, auditado)'
);
select is_empty(
  $$ select 1 from public.profiles where id = pg_temp.person('stu_b') $$,
  'coordenador da equipe A NÃO lê perfil da equipe B'
);
-- Escrita de perfil e contato só por `save_own_profile` (#12): sem grant direto, e a função
-- não recebe o id do alvo (grava só a linha de quem chama).
select throws_ok(
  $$ update public.profiles set district_code = 330455705 where id = pg_temp.person('stu_a') $$,
  '42501', 'permission denied for table profiles',
  'coordenador NÃO edita perfil de membro direto pela API'
);
select throws_ok(
  $$ update public.profile_contacts set social_links_enc = whatsapp_enc
     where profile_id = pg_temp.person('stu_a') $$,
  '42501', 'permission denied for table profile_contacts',
  'coordenador NÃO edita contato de membro direto pela API'
);
select lives_ok(
  $$ select public.save_own_profile(
       p_display_name_enc => 'v1.AAAAAAAAAAAAAAAA.DDDDDDDDDDDDDDDDDDDDDD',
       p_municipality_code => 3304557, p_district_code => null,
       p_whatsapp_enc => 'v1.AAAAAAAAAAAAAAAA.DDDDDDDDDDDDDDDDDDDDDD',
       p_whatsapp_hmac => repeat('d', 64)) $$,
  'coordenador grava pela função: só alcança o próprio perfil'
);

select pg_temp.login('spokes_a');
select set_eq(
  $$ select id from public.profiles $$,
  $$ select id from people
     where name in ('spokes_a', 'stu_a', 'stu_ah', 'stu_ah2', 'stu_hpend') $$,
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
     where name in ('sp_mgr', 'stu_a', 'stu_b', 'stu_c', 'stu_sp', 'stu_ah', 'stu_ah2',
                    'stu_bh', 'stu_hpend', 'stu_hleft', 'stu_ch') $$,
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
select is_empty($$ select 1 from public.municipalities $$, 'quem está na espera NÃO lê municípios');
select is_empty($$ select 1 from public.unit_types $$, 'quem está na espera NÃO lê tipos de unidade');
select is_empty($$ select 1 from public.units $$, 'quem está na espera NÃO lê unidades');
select is_empty($$ select 1 from public.unit_members $$, 'quem está na espera NÃO lê nem o próprio vínculo');
select is_empty($$ select 1 from public.role_assignments $$, 'quem está na espera NÃO lê papéis');

-- Monitor de SP, mas na espera: o papel não vale
select pg_temp.login('mon_wait');
select set_eq(
  $$ select id from public.profiles $$,
  array[pg_temp.person('mon_wait')],
  'monitor na espera lê só o próprio perfil'
);
select is_empty($$ select 1 from public.profile_contacts $$, 'monitor na espera NÃO lê contatos');
select is_empty($$ select 1 from public.units $$, 'monitor na espera NÃO lê unidades');
select is_empty($$ select 1 from public.unit_members $$, 'monitor na espera NÃO lê vínculos');
select is_empty($$ select 1 from public.role_assignments $$, 'monitor na espera NÃO lê papéis, nem o próprio');
select is_empty($$ select 1 from app.my_scopes() $$, 'monitor na espera não tem escopo (my_scopes vazio)');
select is(
  app.has_scope_over('sp'::extensions.ltree, array['monitor']),
  false,
  'monitor na espera não tem escopo (has_scope_over)'
);

-- Pendente: ainda escolhe o município, mas não vê a estrutura
select pg_temp.login('stu_pend');
select isnt_empty($$ select 1 from public.municipalities $$, 'quem está pendente lê municípios (cadastro)');
select is_empty($$ select 1 from public.units $$, 'quem está pendente NÃO lê unidades');

-- Coordenador da equipe A e os vínculos de quem não está ativo
select pg_temp.login('team_a_mon');
select is_empty(
  $$ select 1 from public.unit_members
     where profile_id in (pg_temp.person('stu_wait'), pg_temp.person('stu_blocked'),
                          pg_temp.person('stu_pend'), pg_temp.person('stu_susp')) $$,
  'coordenador NÃO vê vínculo de quem está na espera, bloqueado, pendente ou suspenso'
);
-- Sem WHERE, só a política de UPDATE filtra (a de SELECT não entra).
select lives_ok(
  $$ update public.unit_members set member_role = 'lead' $$,
  'coordenador altera vínculos em massa: os de quem não está ativo não são alcançados'
);

reset role;
select results_eq(
  $$ select district_code, (select social_links_enc from public.profile_contacts
                            where profile_id = pg_temp.person('stu_a'))
     from public.profiles where id = pg_temp.person('stu_a') $$,
  $$ values (null::integer, null::text) $$,
  'perfil e contato do membro não foram alterados pelo coordenador'
);
select results_eq(
  $$ select p.id, c.whatsapp_hmac
     from public.profiles as p join public.profile_contacts as c on c.profile_id = p.id
     where c.whatsapp_hmac = repeat('d', 64) $$,
  $$ select pg_temp.person('team_a_mon'), repeat('d', 64) $$,
  'a gravação do coordenador pela função caiu só na linha dele'
);
select is_empty(
  $$ select 1 from public.unit_members where member_role = 'lead'
     and profile_id in (pg_temp.person('stu_wait'), pg_temp.person('stu_blocked'),
                        pg_temp.person('stu_pend'), pg_temp.person('stu_susp')) $$,
  'os vínculos de quem não está ativo não foram alterados'
);

-- Coordenador da casa 1 no ABC pela RLS (ADR 0011): os vínculos e perfis da casa no território
set local role authenticated;
select pg_temp.login('house_mon');
select set_eq(
  $$ select profile_id, house_key from public.house_members $$,
  $$ select id, 'casa-t1'::text from people where name in ('stu_ah', 'stu_bh') $$,
  'coordenador da casa 1 no ABC lê os vínculos aceitos da casa 1 de quem é do ABC e está ativo (não o histórico de outra casa)'
);
select is_empty($$ select 1 from app.my_scopes() $$,
  'coordenador de casa não tem escopo territorial (my_scopes vazio)');
select is_empty(
  $$ select 1 from public.house_members where house_key <> 'casa-t1' $$,
  'coordenador da casa 1 NÃO lê os vínculos da casa 2'
);
select set_eq(
  $$ select id from public.profiles $$,
  $$ select id from people where name in ('house_mon', 'stu_ah', 'stu_bh') $$,
  'coordenador da casa 1 lê os perfis da casa 1 no ABC, de qualquer equipe; NÃO outra casa, outra região, sem aceite nem quem não está ativo'
);
select is_empty(
  $$ select 1 from public.unit_members $$,
  'coordenador da casa NÃO lê vínculos de território (não gerencia unidade)'
);
select is_empty(
  $$ select 1 from public.profile_contacts $$,
  'coordenador da casa NÃO lê contatos pela tabela (só por view_contact, auditado)'
);
select set_eq(
  $$ select slug from public.units $$,
  array['br', 'sp', 'abc', 'team_a', 'team_b'],
  'coordenador da casa no ABC vê o território (abaixo e o caminho até a raiz), não as vizinhas'
);
select set_eq(
  $$ select profile_id from public.role_assignments $$,
  array[pg_temp.person('house_mon')],
  'coordenador da casa lê só o próprio papel'
);
select results_eq(
  $$ select target_id, house_key from public.audit_log where event = 'house_accepted' order by 1 $$,
  $$ select id, 'casa-t1'::text from people where name in ('stu_ah', 'stu_bh') order by 1 $$,
  'coordenador da casa 1 lê house_accepted dos membros da casa 1 no ABC (#132); não outra casa, outra região nem quem saiu'
);
select is_empty(
  $$ select 1 from public.audit_log where event = 'questionnaire_consented' $$,
  'coordenador da casa NÃO lê o aceite do termo do questionário'
);
select throws_ok(
  $$ update public.house_members set accepted_at = now()
     where profile_id = pg_temp.person('stu_hpend') $$,
  '42501', 'permission denied for table house_members',
  'ninguém grava o aceite por UPDATE direto'
);
select throws_ok(
  $$ update public.house_members set house_key = 'casa-t2'
     where profile_id = pg_temp.person('stu_ah') $$,
  '42501', 'permission denied for table house_members',
  'nem troca a casa'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, accepted_at)
     values (pg_temp.person('stu_a'), 'casa-t1', 'self', now()) $$,
  '42501', 'permission denied for table house_members',
  'vínculo de casa não é criado por INSERT direto (só por accept_house)'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('outsider'), 'house_coordinator', pg_temp.unit('team_a'), 'casa-t1',
             pg_temp.person('house_mon')) $$,
  '42501', null,
  'coordenador de casa NÃO concede o papel'
);
-- Sem WHERE, só a política de UPDATE filtra (a de SELECT não entra): encerra só os vínculos
-- abertos e aceitos da casa 1 no ABC, de quem está ativo.
select lives_ok(
  $$ update public.house_members set left_at = now() $$,
  'coordenador da casa 1 encerra vínculos em massa: só os do seu escopo são alcançados'
);

-- A pessoa com a casa ainda sem aceite: vê os próprios vínculos de casa
select pg_temp.login('stu_hpend');
select set_eq(
  $$ select house_key from public.house_members $$,
  array['casa-t1'],
  'a pessoa lê o próprio vínculo de casa, mesmo sem aceite'
);
select set_eq(
  $$ select slug from public.units $$,
  array['br', 'sp', 'abc', 'team_a'],
  'a casa não é unidade: a pessoa vê só o caminho do território'
);
select set_eq(
  $$ select key from public.houses $$,
  array['casa-exemplo-1', 'casa-exemplo-2', 'casa-exemplo-3', 'casa-exemplo-4',
        'casa-t1', 'casa-t2', 'casa-off'],
  'quem está ativo lê as chaves das casas (sem dado pessoal)'
);
select throws_ok(
  $$ insert into public.houses (key) values ('casa-nova') $$,
  '42501', null,
  'ninguém cria casa pela API'
);
-- A pessoa lê os próprios eventos de casa, não os dos outros (#132)
select pg_temp.login('stu_ah');
select set_eq(
  $$ select event from public.audit_log $$,
  array['house_accepted', 'questionnaire_consented'],
  'a pessoa lê os próprios house_accepted e questionnaire_consented, e nada dos outros'
);
select pg_temp.login('stu_hwait');
select is_empty($$ select 1 from public.house_members $$, 'quem está na espera NÃO lê nem o próprio vínculo de casa');
select is_empty($$ select 1 from public.houses $$, 'quem está na espera NÃO lê as casas');

select pg_temp.login('spokes_a');
select is_empty($$ select 1 from public.house_members $$,
  'porta-voz NÃO lê vínculos de casa (não é coordenação)');

-- Gestor de SP: a coordenação territorial lê vínculos de casa (de qualquer casa) e
-- house_accepted de quem está no seu território; não o termo
select pg_temp.login('sp_mgr');
select set_eq(
  $$ select profile_id from public.house_members $$,
  $$ select id from people where name in ('stu_ah', 'stu_ah2', 'stu_bh', 'stu_hleft', 'stu_ch') $$,
  'gestor de SP lê os vínculos de casa aceitos (inclusive o histórico) de quem está em SP e ativo'
);
select set_eq(
  $$ select target_id from public.audit_log where event = 'house_accepted' $$,
  $$ select id from people where name in ('stu_ah', 'stu_ah2', 'stu_bh', 'stu_ch', 'stu_hleft') $$,
  'gestor de SP lê house_accepted de quem está em SP (#132)'
);
select is_empty(
  $$ select 1 from public.audit_log where event = 'questionnaire_consented' $$,
  'gestor NÃO lê o aceite do termo do questionário'
);
select lives_ok(
  $$ update public.house_members set left_at = now() $$,
  'gestor de SP encerra vínculos de casa em massa: a casa ainda sem aceite não é alcançada'
);
-- Concessão do papel de coordenador de casa (ADR 0011 §5)
select lives_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('zl'), 'casa-t1',
             pg_temp.person('sp_mgr')) $$,
  'gestor de SP concede coordenador de casa numa região do estado'
);
select lives_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('zl'), 'casa-t2',
             pg_temp.person('sp_mgr')) $$,
  'a mesma pessoa pode coordenar outra casa no mesmo território'
);
select lives_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_b'), 'house_coordinator', pg_temp.unit('zl'), 'casa-t1',
             pg_temp.person('sp_mgr')) $$,
  'pode haver mais de um coordenador da mesma casa no mesmo território'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('zl'), 'casa-t1',
             pg_temp.person('sp_mgr')) $$,
  '23505', null,
  'o mesmo papel ativo (pessoa, casa e território) não se repete'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('zl'),
             pg_temp.person('sp_mgr')) $$,
  '23514', null,
  'coordenador de casa sem casa é recusado'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'monitor', pg_temp.unit('zl'), 'casa-t1',
             pg_temp.person('sp_mgr')) $$,
  '23514', null,
  'casa em outro papel é recusada'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('team_c'), 'casa-off',
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'coordenador de casa inativa é recusado'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('team_c'), 'casa-inexistente',
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'coordenador de casa inexistente é recusado'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('sp'), 'casa-t1',
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'gestor de SP NÃO concede coordenador de casa no próprio nível'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('sp_mgr'), 'house_coordinator', pg_temp.unit('zl'), 'casa-t1',
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'gestor de SP NÃO se concede coordenador de casa'
);
select throws_ok(
  $$ insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
     values (pg_temp.person('stu_c'), 'house_coordinator', pg_temp.unit('central'), 'casa-t1',
             pg_temp.person('sp_mgr')) $$,
  '42501', null,
  'gestor de SP NÃO concede coordenador de casa em MG'
);
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where role = 'house_coordinator' and profile_id = pg_temp.person('stu_b') $$,
  'gestor de SP revoga um coordenador de casa abaixo dele'
);
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where role = 'house_coordinator' and profile_id in (pg_temp.person('house_nat'), pg_temp.person('house_mg')) $$,
  'gestor de SP tenta revogar coordenadores de casa na raiz e em MG: não alcança linha nenhuma'
);

reset role;
select set_eq(
  $$ select profile_id from public.house_members where left_at is not null and ended_by = pg_temp.person('house_mon') $$,
  $$ select id from people where name in ('stu_ah', 'stu_bh') $$,
  'o coordenador da casa 1 encerrou só os vínculos do seu escopo, e ficou registrado como quem encerrou'
);
select is(
  (select left_at from public.house_members where profile_id = pg_temp.person('stu_hpend')),
  null,
  'a casa sem aceite não foi encerrada pela coordenação'
);
select is_empty(
  $$ select 1 from public.house_members
     where left_at is not null and ended_by is not null
       and ended_by = pg_temp.person('house_mon')
       and profile_id in (select id from people where name in ('stu_ah2', 'stu_ch', 'stu_mh', 'stu_hpend',
                                                               'stu_hsusp', 'stu_hwait', 'stu_h')) $$,
  'outra casa, outra região, outro estado, sem aceite, sem território e quem não está ativo: nada foi encerrado'
);
select results_eq(
  $$ select profile_id, revoked_at is not null from public.role_assignments
     where role = 'house_coordinator'
       and profile_id in (pg_temp.person('stu_b'), pg_temp.person('house_nat'), pg_temp.person('house_mg'))
     order by 1 $$,
  $$ values (pg_temp.person('stu_b'), true), (pg_temp.person('house_nat'), false),
            (pg_temp.person('house_mg'), false) $$,
  'o gestor de SP revogou só o coordenador de casa abaixo dele'
);

-- Revogar o coordenador NACIONAL de casa (revisão do #141, M1). Quem concedeu exclui a conta
-- (granted_by vira nulo) e não há ninguém acima da raiz: o manager ativo da raiz revoga.
reset role;
insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by)
values (pg_temp.person('stu_a'), 'house_coordinator', pg_temp.unit('br'), 'casa-t1',
        pg_temp.person('gone_granter'));
delete from auth.users where id = pg_temp.person('gone_granter');
select is(
  (select granted_by from public.role_assignments
   where profile_id = pg_temp.person('stu_a') and role = 'house_coordinator'),
  null,
  'quem concedeu o coordenador nacional excluiu a conta: granted_by ficou nulo'
);
-- Neste ponto a raiz não tem manager ativo (revogados acima); root_mgr2 passa a ser.
insert into public.role_assignments (profile_id, role, unit_id)
values (pg_temp.person('root_mgr2'), 'manager', pg_temp.unit('br'));
set local role authenticated;
select pg_temp.login('sp_mgr');
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where role = 'house_coordinator' and unit_id = pg_temp.unit('br') $$,
  'gestor de SP tenta revogar coordenadores nacionais de casa: não alcança linha nenhuma'
);
select pg_temp.login('root_mgr2');
select lives_ok(
  $$ update public.role_assignments set revoked_at = now()
     where role = 'house_coordinator' and unit_id = pg_temp.unit('br')
       and profile_id in (pg_temp.person('stu_a'), pg_temp.person('house_nat')) $$,
  'o manager da raiz revoga coordenadores nacionais de casa que não concedeu (inclusive com granted_by nulo)'
);
reset role;
select results_eq(
  $$ select profile_id, revoked_at is not null from public.role_assignments
     where role = 'house_coordinator' and unit_id = pg_temp.unit('br')
       and profile_id in (pg_temp.person('stu_a'), pg_temp.person('house_nat'), pg_temp.person('house_wait'))
     order by 1 $$,
  $$ values (pg_temp.person('stu_a'), true), (pg_temp.person('house_nat'), true),
            (pg_temp.person('house_wait'), false) $$,
  'só os dois coordenadores nacionais escolhidos foram revogados, pelo manager da raiz (não pelo de SP)'
);

-- Lista de autorizados e HMACs da espera (#26): nenhum papel lê pela API
set local role authenticated;
select pg_temp.login('nat_mgr');
select throws_ok($$ select 1 from public.access_allowlist $$, '42501', null,
  'gestor nacional NÃO lê a lista de autorizados');
select throws_ok($$ select 1 from public.access_waitlist_hmac $$, '42501', null,
  'gestor nacional NÃO lê os HMACs da espera');
select pg_temp.login('tech');
select throws_ok($$ select 1 from public.access_waitlist_hmac $$, '42501', null,
  'admin técnico NÃO lê os HMACs da espera');
select pg_temp.login('stu_wait');
select throws_ok($$ select 1 from public.access_waitlist_hmac $$, '42501', null,
  'quem está na espera NÃO lê os HMACs da espera');

-- Tentativas de WhatsApp repetido (#127): só `save_own_profile` usa; nenhum papel lê pela API,
-- nem o gestor nacional, nem o admin técnico, nem a própria pessoa.
select pg_temp.login('nat_mgr');
select throws_ok($$ select 1 from app.profile_save_attempts $$, '42501', null,
  'gestor nacional NÃO lê as tentativas de WhatsApp repetido');
select pg_temp.login('tech');
select throws_ok($$ select 1 from app.profile_save_attempts $$, '42501', null,
  'admin técnico NÃO lê as tentativas de WhatsApp repetido');
select pg_temp.login('team_a_mon');
select throws_ok($$ delete from app.profile_save_attempts $$, '42501', null,
  'coordenador NÃO apaga tentativas (nem para liberar o limite de um membro)');

-- "Baixar meus dados" (#20): escopo não alcança a exportação. Quem gerencia todo mundo
-- recebe só os próprios vínculos e papéis; nunca os de quem está no seu escopo.
set local role authenticated;
select pg_temp.login('nat_mgr');
select is(
  (select jsonb_array_length(d->'memberships') || '/' || jsonb_array_length(d->'roles') || '/'
          || (d->'roles'->0->>'unit_name') from public.export_own_data() as d),
  '0/1/br',
  'gestor nacional exporta só o próprio papel, sem os vínculos de quem está no escopo'
);
select pg_temp.login('team_a_mon');
select is(
  (select jsonb_array_length(d->'memberships') || '/' || (d->'roles'->0->>'role')
     from public.export_own_data() as d),
  '0/monitor',
  'monitor da equipe NÃO recebe os vínculos dos alunos da equipe na exportação'
);

-- "Excluir minha conta" (#18): a função só apaga a conta de quem chama (não recebe alvo) e
-- exige login recente. Nem o gestor nacional apaga a conta ou o perfil de alguém do escopo.
select pg_temp.login('nat_mgr');
select throws_ok(
  $$ delete from public.profiles where id = (select pg_temp.person('stu_a')) $$,
  '42501', null,
  'gestor nacional NÃO apaga o perfil de um aluno do escopo'
);
select throws_ok(
  $$ select public.delete_own_account() $$,
  'PT401', null,
  'gestor nacional sem login recente NÃO exclui nem a própria conta'
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

select throws_ok(
  $$ select public.export_own_data() $$,
  '42501', null,
  'visitante anônimo NÃO exporta dados'
);
select throws_ok(
  $$ select public.delete_own_account() $$,
  '42501', null,
  'visitante anônimo NÃO exclui conta'
);

reset role;
select * from finish();
rollback;
