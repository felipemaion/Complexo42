-- Quem vê o contato (issue #119, ADR 0010): a escolha da pessoa (`contact_visibility` e
-- `set_contact_visibility`), a leitura auditada (`view_contact`, com limite e registro sem
-- repetição), a lista de quem acessou (`list_contact_views` e `export_own_data`) e o que é "a
-- mesma equipe" e "a mesma casa". A matriz de quem vê está em permissions_matrix.test.sql
-- (R16). Pessoas e árvore fictícias, só nesta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(88);

truncate public.role_assignments, public.unit_members, public.house_members, public.units cascade;

-- ---------------------------------------------------------------------------------------
-- Árvore: br ─┬─ sp (SP) ─┬─ abc ─┬─ team_x
--             │           │       ├─ team_y
--             │           │       ├─ team_old (equipe ARQUIVADA)
--             │           │       └─ team_w
--             │           ├─ zl ──── team_z          (outra região)
--             │           └─ empty_r                 (região sem nada abaixo: folha, não é equipe)
--             └─ mg (MG, sem unidades abaixo)
-- Casas nacionais (ADR 0011), fora da árvore: casa-x e casa-y.
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
select pg_temp.add_unit('region', 'sp', 'abc');
select pg_temp.add_unit('team', 'abc', 'team_x');
select pg_temp.add_unit('team', 'abc', 'team_y');
select pg_temp.add_unit('team', 'abc', 'team_old');
select pg_temp.add_unit('team', 'abc', 'team_w');
select pg_temp.add_unit('region', 'sp', 'zl');
select pg_temp.add_unit('team', 'zl', 'team_z');
select pg_temp.add_unit('region', 'sp', 'empty_r');
select pg_temp.add_unit('state', 'br', 'mg', 'MG');
update public.units set status = 'archived' where slug = 'team_old';
insert into public.houses (key) values ('casa-x'), ('casa-y') on conflict do nothing;

-- Ids lidos como dono do banco, antes de qualquer troca de papel (#113).
create temp table unit_ids (slug text primary key, id uuid not null unique);
insert into unit_ids select slug, id from public.units;
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

create temp table people (name text primary key, id uuid not null unique);
insert into people values
  ('coord',  '00000000-0000-0000-0000-0000000001c0'),  -- monitor da equipe X
  ('a',      '00000000-0000-0000-0000-0000000001a0'),  -- equipe X, sem autorização
  ('b',      '00000000-0000-0000-0000-0000000001b0'),  -- equipe X, WhatsApp e e-mail para a equipe
  ('c',      '00000000-0000-0000-0000-0000000001c1'),  -- equipe Y + casa X há 8 dias, WhatsApp para equipe e casa
  ('d',      '00000000-0000-0000-0000-0000000001d0'),  -- equipe X + casa X há 8 dias
  ('e',      '00000000-0000-0000-0000-0000000001d1'),  -- equipe Z (outra região) + casa X há 8 dias, equipe e casa
  ('f',      '00000000-0000-0000-0000-0000000001d2'),  -- equipe Y + casa X aceita HOJE, equipe e casa
  ('hl',     '00000000-0000-0000-0000-0000000001d3'),  -- equipe W (mesma região) + SAIU da casa X (aceita há 8 dias), equipe e casa
  ('s1',     '00000000-0000-0000-0000-0000000001e1'),  -- só na unidade do estado, autorizou equipe e casa
  ('s2',     '00000000-0000-0000-0000-0000000001e2'),  -- só na unidade do estado
  ('r1',     '00000000-0000-0000-0000-0000000001f1'),  -- só na região, autorizou equipe e casa
  ('r2',     '00000000-0000-0000-0000-0000000001f2'),  -- só na região
  ('k1',     '00000000-0000-0000-0000-0000000001f3'),  -- região sem nada abaixo (folha), autorizou equipe
  ('k2',     '00000000-0000-0000-0000-0000000001f4'),  -- região sem nada abaixo
  ('o1',     '00000000-0000-0000-0000-0000000001f5'),  -- equipe arquivada, autorizou equipe
  ('o2',     '00000000-0000-0000-0000-0000000001f6'),  -- equipe arquivada
  ('blk',    '00000000-0000-0000-0000-0000000001b1'),  -- equipe X, bloqueado
  ('susp',   '00000000-0000-0000-0000-0000000001b8'),  -- equipe X, conta suspensa
  ('crev',   '00000000-0000-0000-0000-0000000001b9'),  -- ex-monitor da equipe X (revogado)
  ('spokes', '00000000-0000-0000-0000-0000000001b2'),  -- porta-voz da equipe X
  ('noprof', '00000000-0000-0000-0000-0000000001b3'),  -- conta sem perfil
  ('hcoord', '00000000-0000-0000-0000-0000000001b4'),  -- coordenador da casa X no ABC
  ('hrev',   '00000000-0000-0000-0000-0000000001b5'),  -- ex-coordenador da casa X no ABC (revogado)
  ('hspk',   '00000000-0000-0000-0000-0000000001b6'),  -- coordenador da casa Y no ABC (outra casa)
  ('cleft',  '00000000-0000-0000-0000-0000000001b7'),  -- saiu da casa X (aceita), sem outro vínculo
  ('j1',     '00000000-0000-0000-0000-0000000001e3'),  -- só na unidade de MG (folha), autorizou equipe e casa
  ('j2',     '00000000-0000-0000-0000-0000000001e4'),  -- só na unidade de MG
  ('rl',     '00000000-0000-0000-0000-0000000001e5'),  -- monitor da equipe X que já viu 60 pessoas na hora
  ('rl2',    '00000000-0000-0000-0000-0000000001e6');  -- monitor da equipe X que viu 60 pessoas há 2 horas
grant select on people, unit_ids to authenticated;
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
create function pg_temp.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.person(p_name), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;

insert into auth.users (id, email) select id, name || '@exemplo.org' from people;
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict (code) do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc('Nome' || name), 3304557, 'v1' from people where name <> 'noprof';
update public.profiles set access_status = 'active', status = 'active';
update public.profiles set access_status = 'blocked' where id = pg_temp.person('blk');
update public.profiles set status = 'suspended' where id = pg_temp.person('susp');
insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac)
select id, pg_temp.enc('Zap' || name), encode(sha256(id::text::bytea), 'hex')
from people where name <> 'noprof';

insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('coord'), 'monitor', pg_temp.unit('team_x')),
  (pg_temp.person('rl'), 'monitor', pg_temp.unit('team_x')),
  (pg_temp.person('rl2'), 'monitor', pg_temp.unit('team_x')),
  (pg_temp.person('spokes'), 'spokesperson', pg_temp.unit('team_x'));
insert into public.role_assignments (profile_id, role, unit_id, revoked_at) values
  (pg_temp.person('crev'), 'monitor', pg_temp.unit('team_x'), now());
insert into public.role_assignments (profile_id, role, unit_id, house_key, revoked_at) values
  (pg_temp.person('hcoord'), 'house_coordinator', pg_temp.unit('abc'), 'casa-x', null),
  (pg_temp.person('hspk'), 'house_coordinator', pg_temp.unit('abc'), 'casa-y', null),
  (pg_temp.person('hrev'), 'house_coordinator', pg_temp.unit('abc'), 'casa-x', now());
insert into public.unit_members (unit_id, profile_id) values
  (pg_temp.unit('team_x'), pg_temp.person('a')),
  (pg_temp.unit('team_x'), pg_temp.person('b')),
  (pg_temp.unit('team_y'), pg_temp.person('c')),
  (pg_temp.unit('team_x'), pg_temp.person('d')),
  (pg_temp.unit('team_z'), pg_temp.person('e')),
  (pg_temp.unit('team_y'), pg_temp.person('f')),
  (pg_temp.unit('team_w'), pg_temp.person('hl')),
  (pg_temp.unit('team_x'), pg_temp.person('blk')),
  (pg_temp.unit('team_x'), pg_temp.person('susp')),
  (pg_temp.unit('sp'), pg_temp.person('s1')),
  (pg_temp.unit('sp'), pg_temp.person('s2')),
  (pg_temp.unit('abc'), pg_temp.person('r1')),
  (pg_temp.unit('abc'), pg_temp.person('r2')),
  (pg_temp.unit('empty_r'), pg_temp.person('k1')),
  (pg_temp.unit('empty_r'), pg_temp.person('k2')),
  (pg_temp.unit('team_old'), pg_temp.person('o1')),
  (pg_temp.unit('team_old'), pg_temp.person('o2')),
  (pg_temp.unit('mg'), pg_temp.person('j1')),
  (pg_temp.unit('mg'), pg_temp.person('j2'));
-- Casa: aceita há 8 dias (passou a carência de 7) ou hoje.
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at) values
  (pg_temp.person('c'), 'casa-x', 'self', now() - interval '8 days', now() - interval '8 days'),
  (pg_temp.person('d'), 'casa-x', 'self', now() - interval '8 days', now() - interval '8 days'),
  (pg_temp.person('e'), 'casa-x', 'self', now() - interval '8 days', now() - interval '8 days'),
  (pg_temp.person('f'), 'casa-x', 'self', now(), now());
insert into public.house_members (profile_id, house_key, join_method, accepted_at, left_at) values
  (pg_temp.person('cleft'), 'casa-x', 'self', now(), now());
insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at, left_at) values
  (pg_temp.person('hl'), 'casa-x', 'self', now() - interval '8 days', now() - interval '8 days', now());
insert into public.contact_visibility (profile_id, kind, scope) values
  (pg_temp.person('b'), 'whatsapp', 'team'),
  (pg_temp.person('b'), 'email', 'team'),
  (pg_temp.person('c'), 'whatsapp', 'team_house'),
  (pg_temp.person('e'), 'whatsapp', 'team_house'),
  (pg_temp.person('f'), 'whatsapp', 'team_house'),
  (pg_temp.person('hl'), 'whatsapp', 'team_house'),
  (pg_temp.person('s1'), 'whatsapp', 'team_house'),
  (pg_temp.person('r1'), 'whatsapp', 'team_house'),
  (pg_temp.person('k1'), 'whatsapp', 'team'),
  (pg_temp.person('o1'), 'whatsapp', 'team'),
  (pg_temp.person('j1'), 'whatsapp', 'team_house'),
  (pg_temp.person('blk'), 'whatsapp', 'team_house');

-- Limite (60 pessoas distintas por hora): `rl` já viu 60 pessoas fictícias na última hora,
-- entre elas `b`; `rl2` viu 60 há 2 horas (fora da janela). Gravado como dono do banco.
insert into public.audit_log (actor_id, event, target_id, reason, created_at)
select pg_temp.person('rl'), 'contact_viewed',
       case when n = 1 then pg_temp.person('b') else gen_random_uuid() end,
       'whatsapp', now() - interval '30 minutes'
from generate_series(1, 60) as n;
insert into public.audit_log (actor_id, event, target_id, reason, created_at)
select pg_temp.person('rl2'), 'contact_viewed', gen_random_uuid(), 'whatsapp', now() - interval '2 hours'
from generate_series(1, 60);

-- ---------------------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------------------
select is((select count(*)::int from unit_ids), 11, 'ids das 11 unidades lidos como dono do banco');
select is_empty($$ select name from people where id is null $$, 'nenhum id de pessoa é nulo');
select columns_are('public', 'contact_visibility',
  array['profile_id', 'kind', 'scope', 'updated_at'],
  'contact_visibility tem só a escolha (nenhum contato, nenhuma coluna de e-mail)');
select is(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where oid in ('public.view_contact(uuid, text)'::regprocedure,
                 'public.set_contact_visibility(text, text)'::regprocedure,
                 'public.list_contact_views()'::regprocedure,
                 'app.can_view_contact(uuid, text)'::regprocedure)),
  true,
  'as funções do contato são security definer com search_path vazio'
);
select hasnt_function('app', 'can_view_contact', array['uuid'],
  'a versão antiga de can_view_contact (sem o tipo) não existe mais');
select set_eq($$ select key from public.unit_types where is_team $$, array['team'],
  'só o tipo `team` do seed é marcado como equipe');
select has_index('public', 'audit_log', 'audit_log_actor_event_created_idx',
  array['actor_id', 'event', 'created_at'],
  'o limite de view_contact conta pelo índice (actor_id, event, created_at) da #20');
select ok(not exists (select 1 from public.unit_types where key = 'house'),
  'a casa não é mais tipo de unidade (ADR 0011): "mesma casa" vem de house_members');

-- ---------------------------------------------------------------------------------------
-- "A mesma equipe": só unidade ativa de tipo marcado como equipe
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('s2');
select is(app.can_view_contact(pg_temp.person('s1'), 'whatsapp'), false,
  'dividir a unidade de entrada do estado NÃO dá acesso, mesmo autorizado');
select pg_temp.login('j2');
select is(app.can_view_contact(pg_temp.person('j1'), 'whatsapp'), false,
  'dividir a unidade do estado NÃO dá acesso, nem quando ela não tem unidades abaixo');
select pg_temp.login('r2');
select is(app.can_view_contact(pg_temp.person('r1'), 'whatsapp'), false,
  'dividir a região (unidade com unidades abaixo) NÃO dá acesso, mesmo autorizado');
select pg_temp.login('k2');
select is(app.can_view_contact(pg_temp.person('k1'), 'whatsapp'), false,
  'unidade sem unidades abaixo que não é equipe NÃO dá acesso');
select pg_temp.login('o2');
select is(app.can_view_contact(pg_temp.person('o1'), 'whatsapp'), false,
  'equipe arquivada NÃO dá acesso');
select pg_temp.login('a');
select is(app.can_view_contact(pg_temp.person('b'), 'whatsapp'), true,
  'colega da mesma equipe vê o contato autorizado para a equipe');
select is(app.can_view_contact(pg_temp.person('b'), 'social'), false,
  'colega NÃO vê o contato que a pessoa não autorizou');
select is(app.can_view_contact(pg_temp.person('b'), 'telefone'), false,
  'tipo de contato desconhecido é negado');
select is(app.can_view_contact(pg_temp.person('a'), null), false,
  'tipo nulo é negado (false, não nulo), até para o próprio');
select is(app.can_view_contact(null, 'whatsapp'), false, 'alvo nulo é negado (false, não nulo)');
select pg_temp.login('blk');
select is(app.can_view_contact(pg_temp.person('b'), 'whatsapp'), false,
  'quem está bloqueado NÃO vê o contato do colega');

-- ---------------------------------------------------------------------------------------
-- "A mesma casa": a mesma casa nacional, o mesmo território mais próximo, aceita há pelo
-- menos 7 dias pelos dois
-- ---------------------------------------------------------------------------------------
select pg_temp.login('d');
select is(app.can_view_contact(pg_temp.person('c'), 'whatsapp'), true,
  'colega de casa da mesma região (outra equipe), os dois há 8 dias, vê o autorizado para equipe e casa');
select is(app.can_view_contact(pg_temp.person('e'), 'whatsapp'), false,
  'colega de casa de OUTRA região NÃO vê, mesmo autorizado');
select is(app.can_view_contact(pg_temp.person('f'), 'whatsapp'), false,
  'quem entrou na casa hoje NÃO é visto pela casa no mesmo dia');
select is(app.can_view_contact(pg_temp.person('hl'), 'whatsapp'), false,
  'ex-colega de casa (saiu da casa, mesma região, mais de 7 dias) NÃO é visto pela casa');
select pg_temp.login('hl');
select is(app.can_view_contact(pg_temp.person('c'), 'whatsapp'), false,
  'quem saiu da casa NÃO vê mais os colegas de casa');
select pg_temp.login('f');
select is(app.can_view_contact(pg_temp.person('c'), 'whatsapp'), true,
  'quem entrou na casa hoje vê o colega pela EQUIPE (mesma equipe Y), não pela casa');
reset role;
update public.unit_members set left_at = now() where profile_id = pg_temp.person('c');
set local role authenticated;
select pg_temp.login('d');
select is(app.can_view_contact(pg_temp.person('c'), 'whatsapp'), false,
  'sem vínculo de território (sem região), a casa sozinha NÃO dá acesso');
reset role;
insert into public.unit_members (unit_id, profile_id) values (pg_temp.unit('team_y'), pg_temp.person('c'));
update public.house_members set accepted_at = now(), joined_at = now()
where profile_id = pg_temp.person('d');
set local role authenticated;
select pg_temp.login('d');
select is(app.can_view_contact(pg_temp.person('c'), 'whatsapp'), false,
  'quem chama e entrou na casa hoje NÃO vê pela casa no mesmo dia');
reset role;
update public.house_members set joined_at = now() - interval '8 days', accepted_at = now() - interval '8 days'
where profile_id = pg_temp.person('d');
set local role authenticated;

-- Coordenador da casa (app.is_house_coordinator_of, ADR 0011): os membros da casa dentro do
-- seu território, de qualquer equipe
select pg_temp.login('hcoord');
select is(app.can_view_contact(pg_temp.person('c'), 'email'), true,
  'coordenador da casa vê o contato do membro da casa (de outra equipe), sem depender da escolha');
select is(app.can_view_contact(pg_temp.person('f'), 'email'), true,
  'coordenador da casa vê quem acabou de entrar (a carência é só entre colegas)');
select is(app.can_view_contact(pg_temp.person('a'), 'whatsapp'), false,
  'coordenador da casa NÃO vê quem não é da casa');
select is(app.can_view_contact(pg_temp.person('cleft'), 'whatsapp'), false,
  'coordenador da casa NÃO vê quem já saiu da casa');
select is(app.can_view_contact(pg_temp.person('e'), 'whatsapp'), false,
  'coordenador da casa no ABC NÃO vê o membro da mesma casa em outra região');
select pg_temp.login('hspk');
select is(app.can_view_contact(pg_temp.person('c'), 'whatsapp'), false,
  'coordenador de OUTRA casa no mesmo território NÃO vê');
select pg_temp.login('hrev');
select is(app.can_view_contact(pg_temp.person('c'), 'whatsapp'), false,
  'papel de coordenador de casa revogado NÃO vale');
select pg_temp.login('hcoord');
select is(public.view_contact(pg_temp.person('c'), 'whatsapp'), pg_temp.enc('Zapc'),
  'coordenador da casa lê o contato do membro da casa pela leitura auditada (view_contact)');
select throws_ok(
  $$ select public.view_contact(pg_temp.person('e'), 'whatsapp') $$,
  '42501', null, 'view_contact recusa o membro da mesma casa fora do território do coordenador');

-- Funções internas não são chamáveis soltas (revelariam a escolha ou o vínculo de outra pessoa).
select throws_ok(
  $$ select app.contact_visibility_of(pg_temp.person('b'), 'whatsapp') $$,
  '42501', null, 'contact_visibility_of NÃO é chamável pela API');
select throws_ok(
  $$ select app.shares_contact_group(pg_temp.person('b'), 'team') $$,
  '42501', null, 'shares_contact_group NÃO é chamável pela API');
select throws_ok(
  $$ select app.shares_open_team(pg_temp.person('a'), pg_temp.person('b')) $$,
  '42501', null, 'shares_open_team NÃO é chamável pela API');
select throws_ok(
  $$ select app.shares_open_house(pg_temp.person('c'), pg_temp.person('d')) $$,
  '42501', null, 'shares_open_house NÃO é chamável pela API');
select throws_ok(
  $$ select app.home_territory(pg_temp.person('c')) $$,
  '42501', null, 'home_territory NÃO é chamável pela API');
select throws_ok(
  $$ select app.is_house_coordinator_of(pg_temp.person('hcoord'), pg_temp.person('c')) $$,
  '42501', null, 'is_house_coordinator_of NÃO é chamável pela API');

-- ---------------------------------------------------------------------------------------
-- A escolha: só o dono, vale na hora
-- ---------------------------------------------------------------------------------------
select pg_temp.login('a');
select is_empty($$ select 1 from public.contact_visibility $$,
  'sem escolha gravada, a pessoa não tem linha (vale `none`) e NÃO lê a escolha dos outros');
select lives_ok($$ select public.set_contact_visibility('whatsapp', 'team') $$,
  'a pessoa autoriza a equipe a ver o WhatsApp');
select set_eq($$ select profile_id, kind, scope from public.contact_visibility $$,
  $$ values (pg_temp.person('a'), 'whatsapp', 'team') $$,
  'a pessoa lê só a própria escolha');
select pg_temp.login('b');
select is(app.can_view_contact(pg_temp.person('a'), 'whatsapp'), true,
  'a autorização vale na hora para o colega de equipe');
select pg_temp.login('a');
select lives_ok($$ select public.set_contact_visibility('whatsapp', 'none') $$,
  'a pessoa volta para "ninguém"');
select pg_temp.login('b');
select is(app.can_view_contact(pg_temp.person('a'), 'whatsapp'), false,
  'voltar para "ninguém" vale na hora');
select throws_ok($$ select public.set_contact_visibility('telefone', 'team') $$,
  '22023', null, 'tipo de contato desconhecido é recusado');
select throws_ok($$ select public.set_contact_visibility('email', 'todos') $$,
  '22023', null, 'escolha fora de none/team/team_house é recusada');
select throws_ok(
  $$ insert into public.contact_visibility (profile_id, kind, scope)
     values (pg_temp.person('b'), 'social', 'team_house') $$,
  '42501', null, 'ninguém grava a escolha direto na tabela');
select throws_ok(
  $$ update public.contact_visibility set scope = 'team_house' $$,
  '42501', null, 'ninguém altera a escolha direto na tabela');
select pg_temp.login('blk');
select throws_ok($$ select public.set_contact_visibility('whatsapp', 'none') $$,
  '42501', null, 'quem está bloqueado NÃO muda a escolha');
select pg_temp.login('noprof');
select throws_ok($$ select public.set_contact_visibility('whatsapp', 'team') $$,
  '42501', null, 'quem ainda não tem perfil NÃO grava escolha');
reset role;
select set_eq(
  $$ select v.kind, v.scope from public.contact_visibility as v where v.profile_id = pg_temp.person('b') $$,
  $$ values ('whatsapp', 'team'), ('email', 'team') $$,
  'as escolhas de outra pessoa não foram tocadas'
);
select is(
  (select scope from public.contact_visibility
   where profile_id = pg_temp.person('blk') and kind = 'whatsapp'),
  'team_house', 'a escolha de quem está bloqueado não mudou');

-- ---------------------------------------------------------------------------------------
-- view_contact: a única leitura do contato de terceiros
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('coord');
select is(public.view_contact(pg_temp.person('a'), 'whatsapp'), pg_temp.enc('Zapa'),
  'a coordenação vê o WhatsApp (cifrado; quem decifra é o servidor)');
select is(public.view_contact(pg_temp.person('a'), 'whatsapp'), pg_temp.enc('Zapa'),
  'ver de novo o mesmo contato em seguida funciona (e não gera outro registro)');
select is(public.view_contact(pg_temp.person('a'), 'email'), 'a@exemplo.org',
  'a coordenação vê o e-mail de login, lido de auth.users');
select is(public.view_contact(pg_temp.person('a'), 'social'), null,
  'contato que a pessoa não tem volta nulo (e não gera registro: não havia o que ver)');
select is_empty($$ select 1 from public.profile_contacts where profile_id <> pg_temp.person('coord') $$,
  'pela tabela, a coordenação lê só o próprio contato');
select pg_temp.login('d');
select is(public.view_contact(pg_temp.person('c'), 'whatsapp'), pg_temp.enc('Zapc'),
  'colega de casa autorizado vê o WhatsApp');
select pg_temp.login('a');
select throws_ok($$ select public.view_contact(pg_temp.person('d'), 'whatsapp') $$,
  '42501', null, 'colega sem autorização NÃO vê o contato');
select throws_ok($$ select public.view_contact(pg_temp.person('b'), 'social') $$,
  '42501', null, 'colega NÃO vê o contato que não foi autorizado');
select throws_ok($$ select public.view_contact(pg_temp.person('b'), 'telefone') $$,
  '22023', null, 'tipo de contato desconhecido é recusado');
select is(public.view_contact(pg_temp.person('a'), 'email'), 'a@exemplo.org',
  'a pessoa vê o próprio e-mail (sem registro: não é acesso de terceiros)');
select pg_temp.login('spokes');
select throws_ok($$ select public.view_contact(pg_temp.person('b'), 'whatsapp') $$,
  '42501', null, 'porta-voz NÃO vê contato');
select pg_temp.login('crev');
select throws_ok($$ select public.view_contact(pg_temp.person('a'), 'whatsapp') $$,
  '42501', null, 'coordenador com papel revogado NÃO vê contato');
select pg_temp.login('susp');
select throws_ok($$ select public.view_contact(pg_temp.person('b'), 'whatsapp') $$,
  '42501', null, 'colega com a conta suspensa NÃO vê contato, mesmo autorizado');
select pg_temp.login('blk');
select throws_ok($$ select public.view_contact(pg_temp.person('b'), 'whatsapp') $$,
  '42501', null, 'colega bloqueado NÃO vê contato, mesmo autorizado');

-- Limite: 60 pessoas distintas por hora por quem chama
select pg_temp.login('rl');
select throws_ok($$ select public.view_contact(pg_temp.person('a'), 'whatsapp') $$,
  '54000', null, 'quem já viu 60 pessoas na última hora NÃO vê a 61ª');
select is(public.view_contact(pg_temp.person('b'), 'email'), 'b@exemplo.org',
  'rever alguém que já entrou na conta da hora não gasta o limite');
select pg_temp.login('rl2');
select is(public.view_contact(pg_temp.person('a'), 'whatsapp'), pg_temp.enc('Zapa'),
  'acessos de mais de uma hora atrás não contam para o limite');
select pg_temp.login('coord');
select is(public.view_contact(pg_temp.person('b'), 'whatsapp'), pg_temp.enc('Zapb'),
  'o limite é por pessoa: outro coordenador continua vendo');

reset role;
select set_eq(
  $$ select actor_id, target_id, reason from public.audit_log
     where event = 'contact_viewed' and created_at = now() $$,
  $$ values (pg_temp.person('coord'), pg_temp.person('a'), 'whatsapp'),
            (pg_temp.person('coord'), pg_temp.person('a'), 'email'),
            (pg_temp.person('coord'), pg_temp.person('b'), 'whatsapp'),
            (pg_temp.person('d'), pg_temp.person('c'), 'whatsapp'),
            (pg_temp.person('hcoord'), pg_temp.person('c'), 'whatsapp'),
            (pg_temp.person('rl'), pg_temp.person('b'), 'email'),
            (pg_temp.person('rl2'), pg_temp.person('a'), 'whatsapp') $$,
  'leituras permitidas com valor gravaram contact_viewed; as negadas, a nula, a própria e a 61ª, não'
);
select is(
  (select count(*)::int from public.audit_log
   where event = 'contact_viewed' and actor_id = pg_temp.person('coord')
     and target_id = pg_temp.person('a') and reason = 'whatsapp'),
  1, 'ver o mesmo contato da mesma pessoa duas vezes em 10 minutos gera um registro só');
select is_empty(
  $$ select 1 from public.audit_log
     where event = 'contact_viewed' and (item_count is not null or term_version is not null) $$,
  'o registro não guarda o valor do contato'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id)
     values (pg_temp.person('coord'), 'contact_viewed', pg_temp.person('a')) $$,
  '23514', null, 'contact_viewed sem o tipo do contato é recusado');
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason)
     values (pg_temp.person('coord'), 'contact_viewed', pg_temp.person('a'), 'manual') $$,
  '23514', null, 'contact_viewed com motivo que não é tipo de contato é recusado');
-- Passados os 10 minutos, um novo acesso gera um novo registro.
insert into public.audit_log (actor_id, event, target_id, reason, created_at)
values (pg_temp.person('d'), 'contact_viewed', pg_temp.person('b'), 'email', now() - interval '11 minutes');
set local role authenticated;
select pg_temp.login('d');
select is(public.view_contact(pg_temp.person('b'), 'email'), 'b@exemplo.org',
  'colega de equipe vê o e-mail autorizado');
reset role;
select is(
  (select count(*)::int from public.audit_log
   where actor_id = pg_temp.person('d') and target_id = pg_temp.person('b') and reason = 'email'),
  2, 'depois de 10 minutos, ver de novo gera um novo registro');

-- ---------------------------------------------------------------------------------------
-- Quem acessou o meu contato
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('a');
select set_eq(
  $$ select viewer_id, viewer_name_enc, kind from public.list_contact_views() $$,
  $$ values (pg_temp.person('coord'), pg_temp.enc('Nomecoord'), 'whatsapp'),
            (pg_temp.person('coord'), pg_temp.enc('Nomecoord'), 'email'),
            (pg_temp.person('rl2'), pg_temp.enc('Nomerl2'), 'whatsapp') $$,
  'a pessoa vê quem acessou o contato dela, qual e quando'
);
select is(
  (select jsonb_array_length(d -> 'contact_views') from public.export_own_data() as d),
  3, '"Baixar meus dados" traz quem acessou o contato');
select is(
  (select d -> 'contact_views' -> 0 ->> 'viewer_name_enc' from public.export_own_data() as d),
  pg_temp.enc('Nomecoord'), 'a exportação traz o nome (cifrado) de quem viu');
select pg_temp.login('c');
select set_eq(
  $$ select viewer_id, kind from public.list_contact_views() $$,
  $$ values (pg_temp.person('d'), 'whatsapp'), (pg_temp.person('hcoord'), 'whatsapp') $$,
  'o colega e o coordenador da casa que viram também aparecem na lista'
);
select pg_temp.login('coord');
select is_empty($$ select 1 from public.list_contact_views() $$,
  'quem viu o contato dos outros NÃO recebe a lista deles');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok(
  $$ select public.view_contact('00000000-0000-0000-0000-0000000001a0'::uuid, 'whatsapp') $$,
  '42501', 'permission denied for function view_contact',
  'visitante anônimo NÃO chama view_contact');
select throws_ok($$ select public.set_contact_visibility('whatsapp', 'team') $$,
  '42501', 'permission denied for function set_contact_visibility',
  'visitante anônimo NÃO chama set_contact_visibility');

reset role;
select * from finish();
rollback;
