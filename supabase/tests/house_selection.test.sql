-- Escolha e aceite da casa (issue #76, ADR 0008 §2 e §2.1; casa nacional, ADR 0011):
-- `accept_house`, `record_questionnaire_consent`, `questionnaire_consents`, as versões do termo,
-- `houses`, `house_members`, quem encerrou o vínculo (`ended_by`) e a auditoria. A matriz de
-- quem vê quem está em permissions_matrix.test.sql.
-- Árvore e pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(89);

truncate public.role_assignments, public.unit_members, public.house_members, public.units;

-- ---------------------------------------------------------------------------------------
-- Árvore de território
--   br ─┬─ sp (SP) ─┬─ abc ──── team_a
--       │           └─ zl ───── team_z
--       └─ mg (MG) ──── central ──── team_m
-- Casas nacionais (fora da árvore): casa-x, casa-y, casa-w e casa-off (inativa).
-- ---------------------------------------------------------------------------------------
create function pg_temp.add_unit(p_type text, p_parent text, p_slug text, p_state char(2) default null)
returns void language sql as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, (select u.id from public.units as u where u.path = p_parent::extensions.ltree),
         p_slug, p_slug, p_state, p_slug::extensions.ltree
  from public.unit_types as t where t.key = p_type
$$;

select pg_temp.add_unit('national', null, 'br');
select pg_temp.add_unit('state', 'br', 'sp', 'SP');
select pg_temp.add_unit('state', 'br', 'mg', 'MG');
select pg_temp.add_unit('region', 'br.sp', 'abc');
select pg_temp.add_unit('region', 'br.sp', 'zl');
select pg_temp.add_unit('region', 'br.mg', 'central');
select pg_temp.add_unit('team', 'br.sp.abc', 'team_a');
select pg_temp.add_unit('team', 'br.sp.zl', 'team_z');
select pg_temp.add_unit('team', 'br.mg.central', 'team_m');

insert into public.houses (key, active) values
  ('casa-x', true), ('casa-y', true), ('casa-w', true), ('casa-off', false)
on conflict (key) do update set active = excluded.active;

-- Versões do termo que existem nesta instância de teste.
insert into app.questionnaire_term_versions (version) values ('termo-1'), ('termo-2')
on conflict do nothing;

-- Ids lidos como dono, antes de qualquer troca de papel (#113).
create temp table unit_ids (path text primary key, id uuid not null unique);
insert into unit_ids select path::text, id from public.units;
grant select on unit_ids to authenticated;
create function pg_temp.unit(p_path text) returns uuid language plpgsql stable as $$
declare
  found_id uuid;
begin
  select id into found_id from unit_ids where path = p_path;
  if found_id is null then
    raise exception 'unidade de teste desconhecida: %', p_path using errcode = 'no_data_found';
  end if;
  return found_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Pessoas
-- ---------------------------------------------------------------------------------------
create temp table people (name text primary key, id uuid not null unique);
insert into people values
  ('p_state',   '00000000-0000-0000-0000-0000000000b1'),  -- ativa, só no estado de SP (sem região)
  ('p_team',    '00000000-0000-0000-0000-0000000000b3'),  -- ativa, na equipe A (ABC)
  ('p_zl',      '00000000-0000-0000-0000-0000000000b4'),  -- ativa, na equipe da Zona Leste
  ('p_mg',      '00000000-0000-0000-0000-0000000000b5'),  -- ativa, na equipe de MG
  ('p_wait',    '00000000-0000-0000-0000-0000000000b6'),  -- na espera
  ('p_pend',    '00000000-0000-0000-0000-0000000000b7'),  -- pendente
  ('p_open',    '00000000-0000-0000-0000-0000000000b8'),  -- equipe A, casa aberta SEM aceite
  ('p_q',       '00000000-0000-0000-0000-0000000000b9'),  -- equipe A, vai pelo questionário
  ('p_removed', '00000000-0000-0000-0000-0000000000bb'),  -- equipe A; a coordenação tira da casa
  ('p_self',    '00000000-0000-0000-0000-0000000000bc'),  -- equipe A; casa encerrada por ela mesma
  ('coord',     '00000000-0000-0000-0000-0000000000bd'),  -- coordenador da casa X no ABC (equipe A)
  ('coord2',    '00000000-0000-0000-0000-0000000000be'),  -- outro coordenador da casa X; exclui a conta
  ('p_removed2','00000000-0000-0000-0000-0000000000bf');  -- equipe A; tirada da casa por coord2
grant select on people to authenticated;
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

insert into auth.users (id) select id from people;
insert into public.municipalities (code, name, state_code) values (3106200, 'Belo Horizonte', 'MG')
on conflict (code) do nothing;
-- O trigger de entrada no estado vincula cada pessoa à unidade do seu estado.
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB',
       case when name = 'p_mg' then 3106200 else 3550308 end, 'v1'
from people;
update public.profiles set access_status = 'active', status = 'active'
where id not in (pg_temp.person('p_wait'), pg_temp.person('p_pend'));
update public.profiles set access_status = 'waitlisted' where id = pg_temp.person('p_wait');

-- A coordenação já pôs as pessoas numa equipe (encerra o vínculo do estado); p_state, não.
update public.unit_members set left_at = now()
where profile_id <> pg_temp.person('p_state');
insert into public.unit_members (unit_id, profile_id)
select pg_temp.unit(u.path), pg_temp.person(u.name)
from (values ('br.sp.abc.team_a', 'p_team'), ('br.sp.zl.team_z', 'p_zl'),
             ('br.mg.central.team_m', 'p_mg'), ('br.sp.abc.team_a', 'p_open'),
             ('br.sp.abc.team_a', 'p_q'), ('br.sp.abc.team_a', 'p_removed'),
             ('br.sp.abc.team_a', 'p_self'), ('br.sp.abc.team_a', 'p_wait'),
             ('br.sp.abc.team_a', 'p_pend'), ('br.sp.abc.team_a', 'coord'),
             ('br.sp.abc.team_a', 'p_removed2')) as u(path, name);
insert into public.role_assignments (profile_id, role, unit_id, house_key) values
  (pg_temp.person('coord'), 'house_coordinator', pg_temp.unit('br.sp.abc'), 'casa-x'),
  (pg_temp.person('coord2'), 'house_coordinator', pg_temp.unit('br.sp.abc'), 'casa-x');
-- Casa aberta e ainda sem aceite (vinda de outro fluxo).
insert into public.house_members (profile_id, house_key, join_method)
values (pg_temp.person('p_open'), 'casa-y', 'self');
-- Casa encerrada pela própria pessoa (quem grava left_at é quem está no JWT; o ended_by enviado,
-- forjado, é ignorado).
select pg_temp.login('p_self');
insert into public.house_members (profile_id, house_key, join_method, left_at, ended_by)
values (pg_temp.person('p_self'), 'casa-y', 'self', now(), pg_temp.person('coord'));
-- Um evento em que p_q é ator, mas que não é de casa: não é lido por ela (#132).
insert into public.audit_log (actor_id, event, target_id, reason)
values (pg_temp.person('p_q'), 'contact_viewed', pg_temp.person('p_team'), 'whatsapp');
reset request.jwt.claims;

-- ---------------------------------------------------------------------------------------
-- Estrutura (como dono)
-- ---------------------------------------------------------------------------------------
select is(
  (select ended_by from public.house_members where profile_id = pg_temp.person('p_self')),
  pg_temp.person('p_self'),
  'ended_by é quem gravou left_at (o valor enviado é ignorado)'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, accepted_at)
     values (pg_temp.person('p_state'), 'casa-w', 'questionnaire', now()) $$,
  '23514', null,
  'casa pelo questionário sem a versão do termo é recusada'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, accepted_at, consent_version)
     values (pg_temp.person('p_state'), 'casa-w', 'self', now(), 'termo-1') $$,
  '23514', null,
  'casa escolhida direto (self) não guarda versão do termo'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method, joined_at, accepted_at)
     values (pg_temp.person('p_state'), 'casa-w', 'self', now(), now() - interval '1 day') $$,
  '23514', null,
  'o aceite não é anterior à entrada'
);
select throws_ok(
  $$ insert into public.house_members (profile_id, house_key, join_method)
     values (pg_temp.person('p_state'), 'casa-w', null) $$,
  '23502', null,
  'a forma de entrada é obrigatória'
);
select has_index('public', 'house_members', 'house_members_profile_id_idx', array['profile_id'],
  'índice completo em house_members(profile_id) (histórico, exportação, exclusão)');
select has_index('public', 'house_members', 'house_members_ended_by_idx', array['ended_by'],
  'índice em house_members(ended_by) (cascata on delete set null)');
select has_index('public', 'role_assignments', 'role_assignments_house_key_idx', array['house_key'],
  'índice em role_assignments(house_key) (FK para houses)');
select hasnt_function('app', 'region_anchor', array['uuid'],
  'a regra de região da casa (#76) não existe mais (ADR 0011)');
select hasnt_function('app', 'house_unit_for', array['uuid', 'text'],
  'nem a unidade de casa por região');
select hasnt_function('app', 'membership_counts', array['text', 'timestamp with time zone'],
  'nem o eixo do vínculo em unit_members');

-- ---------------------------------------------------------------------------------------
-- accept_house
-- ---------------------------------------------------------------------------------------
set local role authenticated;

select pg_temp.login('p_state');
select isnt(public.accept_house('casa-x', 'self', null), null,
  'só no estado (sem região), a pessoa escolhe a casa: não há mais "região não definida"');

select pg_temp.login('p_team');
select isnt(public.accept_house('casa-y', 'self', 'termo-1'), null,
  'quem está numa equipe aceita a casa');
select is(public.accept_house('casa-y', 'self', null),
  (select id from public.house_members where left_at is null),
  'aceitar a mesma casa de novo devolve o mesmo vínculo (clique repetido)');
select throws_ok($$ select public.accept_house('casa-w', 'self', null) $$, '23505', null,
  'com a casa já aceita, outra casa é recusada (troca é com a coordenação)');
select set_eq(
  $$ select house_key from public.house_members $$,
  array['casa-y'],
  'a pessoa tem uma só casa, e lê o próprio vínculo'
);
-- Casa desativada depois do aceite: o clique repetido continua devolvendo o mesmo vínculo (L2).
reset role;
update public.houses set active = false where key = 'casa-y';
set local role authenticated;
select pg_temp.login('p_team');
select is(public.accept_house('casa-y', 'self', null),
  (select id from public.house_members where left_at is null),
  'casa desativada depois do aceite: repetir o aceite devolve o mesmo vínculo (idempotente)');
select throws_ok($$ select public.accept_house('casa-z', 'self', null) $$, '23505', null,
  'com a casa já aceita, outra casa (mesmo inexistente) é recusada como troca');
reset role;
update public.houses set active = true where key = 'casa-y';
set local role authenticated;

select pg_temp.login('p_mg');
select throws_ok($$ select public.accept_house('casa-z', 'self', null) $$, 'P0002', null,
  'casa inexistente é recusada');
select throws_ok($$ select public.accept_house('Casa X', 'self', null) $$, 'P0002', null,
  'id em formato inválido é recusado');
select throws_ok($$ select public.accept_house(null, 'self', null) $$, 'P0002', null,
  'id nulo é recusado');
select throws_ok($$ select public.accept_house('casa-off', 'self', null) $$, 'P0002', null,
  'casa inativa é recusada');
select throws_ok($$ select public.accept_house('casa-x', 'manual', null) $$, '22023', null,
  'forma de entrada fora da lista é recusada');
select throws_ok($$ select public.accept_house('casa-x', null, null) $$, '22023', null,
  'forma de entrada nula é recusada');
select throws_ok($$ select public.accept_house('casa-x', 'questionnaire', 'termo-1') $$, '22023', null,
  'pelo questionário, sem o termo aceito, é recusado');
select isnt(public.accept_house('casa-x', 'self', null), null,
  'em MG, a pessoa aceita a mesma casa nacional');

select pg_temp.login('p_zl');
select isnt(public.accept_house('casa-x', 'self', null), null,
  'na Zona Leste, a pessoa aceita a mesma casa (a casa não depende da região)');

select pg_temp.login('p_wait');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, '42501', null,
  'quem está na espera não escolhe casa');
select pg_temp.login('p_pend');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, '42501', null,
  'quem está pendente não escolhe casa');

select pg_temp.login('p_open');
select isnt(public.accept_house('casa-x', 'self', null), null,
  'com uma casa aberta sem aceite, a pessoa aceita outra');

select pg_temp.login('p_self');
select isnt(public.accept_house('casa-x', 'self', null), null,
  'a casa que a própria pessoa encerrou não impede escolher de novo');

-- ---------------------------------------------------------------------------------------
-- Remoção pela coordenação vale (M3)
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p_removed');
select isnt(public.accept_house('casa-x', 'self', null), null, 'a pessoa aceita a casa X');
select pg_temp.login('coord');
select throws_ok(
  $$ update public.house_members set ended_by = pg_temp.person('p_removed')
     where profile_id = pg_temp.person('p_removed') $$,
  '42501', 'permission denied for table house_members',
  'ninguém grava ended_by pela API'
);
select lives_ok(
  $$ update public.house_members set left_at = now()
     where profile_id = pg_temp.person('p_removed') $$,
  'o coordenador da casa X no ABC encerra o vínculo de quem é do ABC'
);
select lives_ok(
  $$ update public.house_members set left_at = now()
     where profile_id = pg_temp.person('p_zl') $$,
  'o coordenador da casa X no ABC tenta encerrar o vínculo de quem é da Zona Leste: nada é alcançado'
);
select pg_temp.login('coord');
select isnt(public.accept_house('casa-x', 'self', null), null,
  'o coordenador da casa X também é membro da casa X');
select lives_ok(
  $$ update public.house_members set left_at = now() where profile_id = (select auth.uid()) $$,
  'o coordenador tenta encerrar o próprio vínculo de casa: não alcança linha nenhuma (L5)'
);
select is(
  (select count(*)::int from public.house_members where profile_id = (select auth.uid()) and left_at is null),
  1,
  'o coordenador continua lendo o próprio vínculo aberto'
);
select pg_temp.login('p_removed2');
select isnt(public.accept_house('casa-x', 'self', null), null, 'p_removed2 aceita a casa X');
select pg_temp.login('coord2');
select lives_ok(
  $$ update public.house_members set left_at = now() where profile_id = pg_temp.person('p_removed2') $$,
  'coord2 encerra o vínculo de p_removed2'
);
-- coord2 exclui a conta: ended_by vira nulo (on delete set null), e a volta continua bloqueada.
reset role;
delete from auth.users where id = pg_temp.person('coord2');
select is(
  (select ended_by from public.house_members where profile_id = pg_temp.person('p_removed2')),
  null,
  'quem removeu excluiu a conta: ended_by fica nulo'
);
set local role authenticated;
select pg_temp.login('p_removed2');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, 'C7602', null,
  'mesmo com ended_by nulo (quem removeu excluiu a conta), a pessoa NÃO volta sozinha');

select pg_temp.login('p_removed');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, 'C7602', null,
  'tirada pela coordenação, a pessoa NÃO volta sozinha para a mesma casa');
select throws_ok($$ select public.accept_house('casa-y', 'self', null) $$, 'C7602', null,
  'nem entra sozinha em outra casa');
select set_eq(
  $$ select event from public.audit_log $$,
  array['house_accepted'],
  'a pessoa lê o próprio house_accepted (#132)'
);

-- ---------------------------------------------------------------------------------------
-- Termo do questionário (M1)
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p_q');
select throws_ok($$ select public.record_questionnaire_consent('termo-inexistente') $$, '22023', null,
  'versão do termo que não existe é recusada');
select throws_ok($$ select public.record_questionnaire_consent(null) $$, '22023', null,
  'versão nula é recusada');
select isnt(public.record_questionnaire_consent('termo-1'), null,
  'o aceite de uma versão existente devolve a data');
select is(
  public.record_questionnaire_consent('termo-1'),
  (select consented_at from public.questionnaire_consents where term_version = 'termo-1'),
  'repetir o aceite da mesma versão mantém a data do primeiro'
);
select throws_ok($$ select public.accept_house('casa-x', 'questionnaire', 'termo-2') $$, '22023', null,
  'o aceite de outra versão do termo NÃO serve');
select throws_ok($$ select public.accept_house('casa-x', 'questionnaire', null) $$, '22023', null,
  'pelo questionário sem dizer a versão é recusado');
select throws_ok($$ select public.accept_house('casa-x', 'questionnaire', 'termo-inexistente') $$, '22023', null,
  'pelo questionário com versão inexistente é recusado');
select isnt(public.accept_house('casa-x', 'questionnaire', 'termo-1'), null,
  'com o termo desta versão aceito, a casa sugerida é aceita');
select set_eq(
  $$ select term_version from public.questionnaire_consents $$,
  array['termo-1'],
  'a pessoa lê só o próprio aceite'
);
select set_eq(
  $$ select event || ':' || coalesce(term_version, '-') from public.audit_log $$,
  array['questionnaire_consented:termo-1', 'house_accepted:termo-1'],
  'a pessoa lê os próprios eventos de casa e do termo (#132)'
);
select throws_ok(
  $$ insert into public.questionnaire_consents (profile_id, term_version)
     values ((select auth.uid()), 'termo-2') $$,
  '42501', null,
  'o aceite não é gravado por INSERT direto'
);
select throws_ok(
  $$ update public.questionnaire_consents set consented_at = now() - interval '1 year' $$,
  '42501', null,
  'a data do aceite não é reescrita'
);
select throws_ok($$ select 1 from app.questionnaire_term_versions $$, '42501', null,
  'as versões do termo não são lidas pela API');
select throws_ok(
  $$ insert into app.questionnaire_term_versions (version) values ('termo-meu') $$,
  '42501', null,
  'nem criadas pela API'
);

select pg_temp.login('p_team');
select is_empty($$ select 1 from public.questionnaire_consents $$,
  'outra pessoa NÃO lê o aceite de ninguém');
select is_empty($$ select 1 from public.audit_log where actor_id <> (select auth.uid()) $$,
  'outra pessoa NÃO lê os eventos de casa de ninguém');
select pg_temp.login('p_wait');
select throws_ok($$ select public.record_questionnaire_consent('termo-1') $$, '42501', null,
  'quem está na espera não registra o termo');

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, '42501', null,
  'visitante anônimo não escolhe casa');
select throws_ok($$ select public.record_questionnaire_consent('termo-1') $$, '42501', null,
  'visitante anônimo não registra termo');
select throws_ok($$ select 1 from public.questionnaire_consents $$, '42501', null,
  'visitante anônimo não lê aceites');
select throws_ok($$ select 1 from public.house_members $$, '42501', null,
  'visitante anônimo não lê vínculos de casa');

-- ---------------------------------------------------------------------------------------
-- Conferência como dono do banco
-- ---------------------------------------------------------------------------------------
reset role;
reset request.jwt.claims;
select results_eq(
  $$ select p.name, h.house_key, h.join_method, h.consent_version
     from public.house_members h
     join people p on p.id = h.profile_id
     where h.left_at is null and h.accepted_at is not null
     order by p.name $$,
  $$ values ('coord'::text, 'casa-x'::text, 'self'::text, null::text),
            ('p_mg', 'casa-x', 'self', null),
            ('p_open', 'casa-x', 'self', null),
            ('p_q', 'casa-x', 'questionnaire', 'termo-1'),
            ('p_self', 'casa-x', 'self', null),
            ('p_state', 'casa-x', 'self', null),
            ('p_team', 'casa-y', 'self', null),
            ('p_zl', 'casa-x', 'self', null) $$,
  'cada casa aceita guarda a casa, a forma de entrada e a versão do termo (só no questionário)'
);
select results_eq(
  $$ select left_at is not null, accepted_at is null, ended_by = pg_temp.person('p_open')
     from public.house_members
     where profile_id = pg_temp.person('p_open') and house_key = 'casa-y' $$,
  $$ values (true, true, true) $$,
  'a casa aberta sem aceite foi encerrada (não apagada) pela própria pessoa'
);
select is(
  (select ended_by from public.house_members where profile_id = pg_temp.person('p_removed')),
  pg_temp.person('coord'),
  'quem tirou da casa ficou gravado em ended_by'
);
select is(
  (select count(*)::int from public.house_members where profile_id = pg_temp.person('p_team')),
  1,
  'o clique repetido não criou outro vínculo'
);
select is_empty(
  $$ select 1 from public.house_members
     where profile_id in (pg_temp.person('p_wait'), pg_temp.person('p_pend')) $$,
  'as tentativas recusadas não gravaram casa'
);
select is(
  (select count(*)::int from public.house_members
   where profile_id = pg_temp.person('p_removed') and left_at is null),
  0,
  'quem a coordenação tirou continua sem casa aberta'
);

-- Auditoria: quem, qual casa, forma e versão; o alvo é a própria pessoa; nunca respostas.
select results_eq(
  $$ select p.name, a.target_id = a.actor_id, a.house_key, a.reason, a.term_version
     from public.audit_log a join people p on p.id = a.actor_id
     where a.event = 'house_accepted' order by p.name, a.id $$,
  $$ values ('coord'::text, true, 'casa-x'::text, 'self'::text, null::text),
            ('p_mg', true, 'casa-x', 'self', null),
            ('p_open', true, 'casa-x', 'self', null),
            ('p_q', true, 'casa-x', 'questionnaire', 'termo-1'),
            ('p_removed', true, 'casa-x', 'self', null),
            ('p_removed2', true, 'casa-x', 'self', null),
            ('p_self', true, 'casa-x', 'self', null),
            ('p_state', true, 'casa-x', 'self', null),
            ('p_team', true, 'casa-y', 'self', null),
            ('p_zl', true, 'casa-x', 'self', null) $$,
  'cada aceite (e só o primeiro clique) gera house_accepted com a pessoa, a casa, a forma e a versão'
);
select results_eq(
  $$ select p.name, a.term_version, a.target_id
     from public.audit_log a join people p on p.id = a.actor_id
     where a.event = 'questionnaire_consented' $$,
  $$ values ('p_q'::text, 'termo-1'::text, null::uuid) $$,
  'o aceite do termo gera questionnaire_consented uma vez por versão'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason, house_key)
     values (pg_temp.person('p_q'), 'house_accepted', pg_temp.person('p_q'), 'manual', 'casa-x') $$,
  '23514', null,
  'house_accepted só aceita self ou questionnaire como forma'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason, house_key)
     values (pg_temp.person('p_q'), 'house_accepted', pg_temp.person('p_q'), 'questionnaire', 'casa-x') $$,
  '23514', null,
  'house_accepted pelo questionário exige a versão do termo'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason)
     values (pg_temp.person('p_q'), 'house_accepted', pg_temp.person('p_q'), 'self') $$,
  '23514', null,
  'house_accepted exige a casa'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason, house_key)
     values (pg_temp.person('p_q'), 'house_accepted', pg_temp.person('p_team'), 'self', 'casa-x') $$,
  '23514', null,
  'house_accepted tem como alvo a própria pessoa'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, house_key)
     values (pg_temp.person('p_q'), 'data_exported', pg_temp.person('p_q'), 'casa-x') $$,
  '23514', null,
  'a casa só existe em house_accepted'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, reason)
     values (pg_temp.person('p_q'), 'access_granted', 'self') $$,
  '23514', null,
  'os motivos de acesso continuam só manual ou import'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event) values (pg_temp.person('p_q'), 'questionnaire_consented') $$,
  '23514', null,
  'questionnaire_consented exige a versão'
);

-- A constraint de eventos (20261119190100) continua com todos os eventos.
select lives_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, item_count, reason, term_version, house_key)
     select pg_temp.person('p_q'), e,
            case when e = 'house_accepted' then pg_temp.person('p_q') end,
            case when e = 'allowlist_imported' then 1 end,
            case when e in ('access_granted', 'access_blocked') then 'manual'
                 when e = 'house_accepted' then 'self'
                 when e = 'contact_viewed' then 'whatsapp' end,  -- o tipo do contato (#119)
            case when e = 'questionnaire_consented' then 'termo-1' end,
            case when e = 'house_accepted' then 'casa-x' end
     from unnest(array['contact_viewed', 'role_granted', 'role_revoked', 'member_moved',
       'logo_approved', 'export', 'badge_granted', 'badge_revoked', 'submission_approved',
       'submission_rejected', 'points_adjusted', 'account_deleted', 'allowlist_imported',
       'access_granted', 'access_blocked', 'data_exported', 'house_accepted',
       'questionnaire_consented']) as e $$,
  'o audit_log aceita todos os eventos'
);

-- Só a casa: nenhuma coluna nem parâmetro recebe as respostas do questionário.
select set_eq(
  $$ select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'questionnaire_consents' $$,
  array['profile_id', 'term_version', 'consented_at'],
  'questionnaire_consents guarda só pessoa, versão do termo e data'
);
select columns_are('public', 'house_members',
  array['id', 'profile_id', 'house_key', 'join_method', 'consent_version', 'joined_at',
        'accepted_at', 'left_at', 'ended_by'],
  'house_members guarda só a pessoa, a casa, a forma, a versão do termo e as datas'
);
select columns_are('public', 'houses', array['key', 'active', 'created_at'],
  'houses guarda só a chave e a situação (nome e textos ficam na config, R17)');
select is(
  (select pg_get_function_identity_arguments('public.accept_house(text, text, text)'::regprocedure)),
  'p_house_key text, p_join_method text, p_term_version text',
  'accept_house recebe só a casa, a forma de entrada e a versão do termo'
);
-- Única exceção (ADR 0014): as respostas do pedido de análise do resultado inconclusivo, que
-- só existem com o pedido aberto (testado em questionnaire_results.test.sql).
select is_empty(
  $$ select 1 from information_schema.columns
     where table_schema in ('public', 'app') and column_name ~ '(answer|resposta|temperament|score)'
       and (table_name, column_name) <> ('house_analysis_requests', 'answers') $$,
  'nenhuma coluna do banco guarda resposta, temperamento ou pontuação, além das respostas do pedido de análise'
);
select ok(
  not has_function_privilege('authenticated', 'app.open_house_of(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.coordinates_house_in_territory(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'app.is_house_coordinator_of(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.accept_house(text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.record_questionnaire_consent(text)', 'execute'),
  'as regras internas não são chamáveis pela API; as RPCs são fechadas para anon'
);
select ok(
  not has_table_privilege('authenticated', 'public.questionnaire_consents', 'insert')
  and not has_table_privilege('authenticated', 'public.questionnaire_consents', 'update')
  and not has_table_privilege('authenticated', 'public.questionnaire_consents', 'delete')
  and not has_table_privilege('authenticated', 'public.house_members', 'insert')
  and not has_table_privilege('authenticated', 'public.house_members', 'delete')
  and not has_table_privilege('authenticated', 'public.houses', 'insert')
  and not has_table_privilege('authenticated', 'public.houses', 'update')
  and not has_column_privilege('authenticated', 'public.house_members', 'accepted_at', 'update')
  and not has_column_privilege('authenticated', 'public.house_members', 'join_method', 'update')
  and not has_column_privilege('authenticated', 'public.house_members', 'consent_version', 'update')
  and not has_column_privilege('authenticated', 'public.house_members', 'ended_by', 'update')
  and not has_column_privilege('authenticated', 'public.house_members', 'house_key', 'update')
  and not has_column_privilege('authenticated', 'public.house_members', 'profile_id', 'update')
  and has_column_privilege('authenticated', 'public.house_members', 'left_at', 'update'),
  'aceite, casa, versão e quem encerrou só pelas funções e triggers; a coordenação só encerra'
);

select * from finish();
rollback;
