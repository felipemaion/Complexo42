-- Escolha e aceite da casa (issue #76, ADR 0008 §2 e §2.1): `accept_house`,
-- `record_questionnaire_consent`, `questionnaire_consents`, as versões do termo, a regra da
-- região (`app.region_anchor`, `app.house_unit_for`), quem encerrou o vínculo (`ended_by`) e
-- a auditoria. A matriz de quem vê quem está em permissions_matrix.test.sql.
-- Árvore e pessoas fictícias, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(73);

truncate public.role_assignments, public.unit_members, public.units;

-- ---------------------------------------------------------------------------------------
-- Árvore
--   br ─┬─ sp (SP) ─┬─ abc ─┬─ team_a
--       │           │       ├─ casa_x, casa_y, casa_w, casa_v
--       │           │       └─ casa_old (arquivada)
--       │           ├─ casa_v (direto no estado)
--       │           └─ zl ──┬─ team_z
--       │                   └─ casa_y
--       ├─ casa_n (direto na raiz, acima dos estados)
--       └─ mg (MG) ──── central ─┬─ team_m
--                                └─ casa_x
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
select pg_temp.add_unit('house', 'br.sp.abc', 'casa_x');
select pg_temp.add_unit('house', 'br.sp.abc', 'casa_y');
select pg_temp.add_unit('house', 'br.sp.abc', 'casa_w');
select pg_temp.add_unit('house', 'br.sp.abc', 'casa_v');
select pg_temp.add_unit('house', 'br.sp.abc', 'casa_old');
select pg_temp.add_unit('house', 'br.sp', 'casa_v');
select pg_temp.add_unit('house', 'br', 'casa_n');
select pg_temp.add_unit('team', 'br.sp.zl', 'team_z');
select pg_temp.add_unit('house', 'br.sp.zl', 'casa_y');
select pg_temp.add_unit('team', 'br.mg.central', 'team_m');
select pg_temp.add_unit('house', 'br.mg.central', 'casa_x');
update public.units set status = 'archived' where slug = 'casa_old';

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
  ('p_reg',     '00000000-0000-0000-0000-0000000000b2'),  -- ativa, direto na região ABC
  ('p_team',    '00000000-0000-0000-0000-0000000000b3'),  -- ativa, na equipe A (ABC)
  ('p_zl',      '00000000-0000-0000-0000-0000000000b4'),  -- ativa, na equipe da Zona Leste
  ('p_mg',      '00000000-0000-0000-0000-0000000000b5'),  -- ativa, na equipe de MG
  ('p_wait',    '00000000-0000-0000-0000-0000000000b6'),  -- na espera
  ('p_pend',    '00000000-0000-0000-0000-0000000000b7'),  -- pendente
  ('p_open',    '00000000-0000-0000-0000-0000000000b8'),  -- equipe A, casa aberta SEM aceite
  ('p_q',       '00000000-0000-0000-0000-0000000000b9'),  -- equipe A, vai pelo questionário
  ('p_zl2',     '00000000-0000-0000-0000-0000000000ba'),  -- Zona Leste, casa do ABC sem aceite
  ('p_removed', '00000000-0000-0000-0000-0000000000bb'),  -- equipe A; a coordenação tira da casa
  ('p_self',    '00000000-0000-0000-0000-0000000000bc'),  -- equipe A; casa encerrada por ela mesma
  ('coord',     '00000000-0000-0000-0000-0000000000bd');  -- coordenador da casa X do ABC
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

-- A coordenação já pôs as pessoas numa região ou equipe (encerra o vínculo do estado).
update public.unit_members set left_at = now()
where profile_id <> pg_temp.person('p_state');
insert into public.unit_members (unit_id, profile_id)
select pg_temp.unit(u.path), pg_temp.person(u.name)
from (values ('br.sp.abc', 'p_reg'), ('br.sp.abc.team_a', 'p_team'), ('br.sp.zl.team_z', 'p_zl'),
             ('br.mg.central.team_m', 'p_mg'), ('br.sp.abc.team_a', 'p_open'),
             ('br.sp.abc.team_a', 'p_q'), ('br.sp.zl.team_z', 'p_zl2'),
             ('br.sp.abc.team_a', 'p_removed'), ('br.sp.abc.team_a', 'p_self'),
             ('br.sp.abc.team_a', 'p_wait'), ('br.sp.abc.team_a', 'p_pend')) as u(path, name);
insert into public.role_assignments (profile_id, role, unit_id)
values (pg_temp.person('coord'), 'monitor', pg_temp.unit('br.sp.abc.casa_x'));
-- Casas abertas e ainda sem aceite (vindas de outro fluxo).
insert into public.unit_members (unit_id, profile_id, join_method) values
  (pg_temp.unit('br.sp.abc.casa_y'), pg_temp.person('p_open'), 'self'),
  (pg_temp.unit('br.sp.abc.casa_y'), pg_temp.person('p_zl2'), 'self');
-- Casa encerrada pela própria pessoa (quem grava left_at é quem está no JWT).
select pg_temp.login('p_self');
insert into public.unit_members (unit_id, profile_id, join_method, left_at)
values (pg_temp.unit('br.sp.abc.casa_y'), pg_temp.person('p_self'), 'self', now());
reset request.jwt.claims;

-- ---------------------------------------------------------------------------------------
-- Região e casa (como dono)
-- ---------------------------------------------------------------------------------------
select is_empty($$ select 1 from app.region_anchor(pg_temp.person('p_state')) $$,
  'só no estado: a região não está definida');
select is(app.house_unit_for(pg_temp.person('p_state'), 'casa-x'), null,
  'só no estado: nenhuma casa, mesmo com uma única no estado (sem o fallback)');
select is(app.house_unit_for(pg_temp.person('p_reg'), 'casa-x'), pg_temp.unit('br.sp.abc.casa_x'),
  'direto na região: a casa da região');
select is(app.house_unit_for(pg_temp.person('p_team'), 'casa-y'), pg_temp.unit('br.sp.abc.casa_y'),
  'na equipe do ABC: a casa Y do ABC, não a da Zona Leste');
select is(app.house_unit_for(pg_temp.person('p_zl'), 'casa-x'), null,
  'na Zona Leste: a casa X só existe no ABC, fora da região da pessoa');
select is(app.house_unit_for(pg_temp.person('p_zl'), 'casa-y'), pg_temp.unit('br.sp.zl.casa_y'),
  'na Zona Leste: a casa Y da Zona Leste');
select is(app.house_unit_for(pg_temp.person('p_mg'), 'casa-x'), pg_temp.unit('br.mg.central.casa_x'),
  'em MG: a casa X de MG');
select is(app.house_unit_for(pg_temp.person('p_team'), 'casa-v'), pg_temp.unit('br.sp.abc.casa_v'),
  'a mesma casa na região e no estado: vale a mais próxima (a da região)');
select is(app.house_unit_for(pg_temp.person('p_team'), 'casa-n'), null,
  'casa acima do estado da pessoa não é oferecida');
select is(app.house_unit_for(pg_temp.person('p_zl2'), 'casa-x'), null,
  'a região vem do vínculo de equipe, não de uma casa aberta noutra região');
select is(app.house_unit_for(pg_temp.person('p_team'), 'casa-old'), null,
  'casa arquivada não é oferecida');
select is(app.house_unit_for(pg_temp.person('p_team'), 'team-a'), null,
  'uma equipe não é casa, mesmo com o slug certo');
select is(app.house_unit_for(pg_temp.person('p_team'), 'casa_x'), null,
  'id fora do formato da config (com _) é recusado');
select is(
  (select ended_by from public.unit_members
   where profile_id = pg_temp.person('p_self') and axis = 'house'),
  pg_temp.person('p_self'),
  'ended_by é quem gravou left_at'
);
select throws_ok(
  $$ insert into public.unit_members (unit_id, profile_id, join_method, accepted_at)
     values (pg_temp.unit('br.sp.abc.casa_w'), pg_temp.person('p_state'), 'questionnaire', now()) $$,
  '23514', null,
  'casa pelo questionário sem a versão do termo é recusada'
);
select throws_ok(
  $$ insert into public.unit_members (unit_id, profile_id, join_method, accepted_at, consent_version)
     values (pg_temp.unit('br.sp.abc.casa_w'), pg_temp.person('p_state'), 'self', now(), 'termo-1') $$,
  '23514', null,
  'casa escolhida direto (self) não guarda versão do termo'
);

-- ---------------------------------------------------------------------------------------
-- accept_house
-- ---------------------------------------------------------------------------------------
set local role authenticated;

select pg_temp.login('p_state');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, 'C7601',
  'sua região ainda não foi definida',
  'só no estado: recusado com "sua região ainda não foi definida"');

select pg_temp.login('p_team');
select is(public.accept_house('casa-y', 'self', 'termo-1'), pg_temp.unit('br.sp.abc.casa_y'),
  'quem está numa equipe aceita a casa da sua região');
select is(public.accept_house('casa-y', 'self', null), pg_temp.unit('br.sp.abc.casa_y'),
  'aceitar a mesma casa de novo devolve a mesma (clique repetido)');
select throws_ok($$ select public.accept_house('casa-w', 'self', null) $$, '23505', null,
  'com a casa já aceita, outra casa é recusada (troca é com a coordenação)');
select set_eq(
  $$ select unit_id from public.unit_members where axis = 'house' $$,
  array[pg_temp.unit('br.sp.abc.casa_y')],
  'a pessoa tem uma só casa, e lê o próprio vínculo'
);
select throws_ok($$ select public.accept_house('casa-z', 'self', null) $$, 'P0002', null,
  'casa inexistente na região é recusada');
select throws_ok($$ select public.accept_house('Casa X', 'self', null) $$, 'P0002', null,
  'id em formato inválido é recusado');
select throws_ok($$ select public.accept_house(null, 'self', null) $$, 'P0002', null,
  'id nulo é recusado');

select pg_temp.login('p_reg');
select throws_ok($$ select public.accept_house('casa-x', 'manual', null) $$, '22023', null,
  'forma de entrada fora da lista é recusada');
select throws_ok($$ select public.accept_house('casa-x', null, null) $$, '22023', null,
  'forma de entrada nula é recusada');
select throws_ok($$ select public.accept_house('casa-x', 'questionnaire', 'termo-1') $$, '22023', null,
  'pelo questionário, sem o termo aceito, é recusado');
select is(public.accept_house('casa-x', 'self', null), pg_temp.unit('br.sp.abc.casa_x'),
  'direto na região, a pessoa aceita a casa da região');

select pg_temp.login('p_zl');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, 'P0002', null,
  'casa de outra região é recusada');

select pg_temp.login('p_wait');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, '42501', null,
  'quem está na espera não escolhe casa');
select pg_temp.login('p_pend');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, '42501', null,
  'quem está pendente não escolhe casa');

select pg_temp.login('p_open');
select is(public.accept_house('casa-x', 'self', null), pg_temp.unit('br.sp.abc.casa_x'),
  'com uma casa aberta sem aceite, a pessoa aceita outra');

select pg_temp.login('p_self');
select is(public.accept_house('casa-x', 'self', null), pg_temp.unit('br.sp.abc.casa_x'),
  'a casa que a própria pessoa encerrou não impede escolher de novo');

-- ---------------------------------------------------------------------------------------
-- Remoção pela coordenação vale (M3)
-- ---------------------------------------------------------------------------------------
select pg_temp.login('p_removed');
select is(public.accept_house('casa-x', 'self', null), pg_temp.unit('br.sp.abc.casa_x'),
  'a pessoa aceita a casa X');
select pg_temp.login('coord');
select throws_ok(
  $$ update public.unit_members set ended_by = pg_temp.person('p_removed')
     where profile_id = pg_temp.person('p_removed') and axis = 'house' $$,
  '42501', 'permission denied for table unit_members',
  'ninguém grava ended_by pela API'
);
select lives_ok(
  $$ update public.unit_members set left_at = now()
     where profile_id = pg_temp.person('p_removed') and axis = 'house' $$,
  'o coordenador da casa encerra o vínculo'
);
select pg_temp.login('p_removed');
select throws_ok($$ select public.accept_house('casa-x', 'self', null) $$, 'C7602', null,
  'tirada pela coordenação, a pessoa NÃO volta sozinha para a mesma casa');
select throws_ok($$ select public.accept_house('casa-y', 'self', null) $$, 'C7602', null,
  'nem entra sozinha em outra casa');

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
select is(public.accept_house('casa-x', 'questionnaire', 'termo-1'), pg_temp.unit('br.sp.abc.casa_x'),
  'com o termo desta versão aceito, a casa sugerida é aceita');
select set_eq(
  $$ select term_version from public.questionnaire_consents $$,
  array['termo-1'],
  'a pessoa lê só o próprio aceite'
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

-- ---------------------------------------------------------------------------------------
-- Conferência como dono do banco
-- ---------------------------------------------------------------------------------------
reset role;
reset request.jwt.claims;
select results_eq(
  $$ select p.name, u.path::text, m.join_method, m.accepted_at is not null, m.axis, m.consent_version
     from public.unit_members m
     join people p on p.id = m.profile_id
     join public.units u on u.id = m.unit_id
     where m.axis = 'house' and m.left_at is null and m.accepted_at is not null
     order by p.name $$,
  $$ values ('p_open'::text, 'br.sp.abc.casa_x'::text, 'self'::text, true, 'house'::text, null::text),
            ('p_q', 'br.sp.abc.casa_x', 'questionnaire', true, 'house', 'termo-1'),
            ('p_reg', 'br.sp.abc.casa_x', 'self', true, 'house', null),
            ('p_self', 'br.sp.abc.casa_x', 'self', true, 'house', null),
            ('p_team', 'br.sp.abc.casa_y', 'self', true, 'house', null) $$,
  'cada casa aceita guarda a unidade, a forma de entrada, o aceite e a versão do termo (só no questionário)'
);
select results_eq(
  $$ select left_at is not null, accepted_at is null, ended_by = pg_temp.person('p_open')
     from public.unit_members
     where profile_id = pg_temp.person('p_open') and unit_id = pg_temp.unit('br.sp.abc.casa_y') $$,
  $$ values (true, true, true) $$,
  'a casa aberta sem aceite foi encerrada (não apagada) pela própria pessoa'
);
select is(
  (select ended_by from public.unit_members
   where profile_id = pg_temp.person('p_removed') and axis = 'house'),
  pg_temp.person('coord'),
  'quem tirou da casa ficou gravado em ended_by'
);
select is(
  (select count(*)::int from public.unit_members
   where profile_id = pg_temp.person('p_team') and axis = 'house'),
  1,
  'o clique repetido não criou outro vínculo'
);
select is_empty(
  $$ select 1 from public.unit_members
     where profile_id in (pg_temp.person('p_state'), pg_temp.person('p_zl'),
                          pg_temp.person('p_wait'), pg_temp.person('p_pend'))
       and axis = 'house' $$,
  'as tentativas recusadas não gravaram casa'
);
select is(
  (select count(*)::int from public.unit_members
   where profile_id = pg_temp.person('p_removed') and axis = 'house'),
  1,
  'quem a coordenação tirou continua sem casa aberta'
);

-- Auditoria (L7): quem, qual unidade, forma e versão; nunca respostas.
select results_eq(
  $$ select p.name, a.target_id, a.reason, a.term_version
     from public.audit_log a join people p on p.id = a.actor_id
     where a.event = 'house_accepted' order by p.name, a.id $$,
  $$ values ('p_open'::text, pg_temp.unit('br.sp.abc.casa_x'), 'self'::text, null::text),
            ('p_q', pg_temp.unit('br.sp.abc.casa_x'), 'questionnaire', 'termo-1'),
            ('p_reg', pg_temp.unit('br.sp.abc.casa_x'), 'self', null),
            ('p_removed', pg_temp.unit('br.sp.abc.casa_x'), 'self', null),
            ('p_self', pg_temp.unit('br.sp.abc.casa_x'), 'self', null),
            ('p_team', pg_temp.unit('br.sp.abc.casa_y'), 'self', null) $$,
  'cada aceite (e só o primeiro clique) gera house_accepted com a unidade, a forma e a versão'
);
select results_eq(
  $$ select p.name, a.term_version, a.target_id
     from public.audit_log a join people p on p.id = a.actor_id
     where a.event = 'questionnaire_consented' $$,
  $$ values ('p_q'::text, 'termo-1'::text, null::uuid) $$,
  'o aceite do termo gera questionnaire_consented uma vez por versão'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason)
     values (pg_temp.person('p_q'), 'house_accepted', pg_temp.unit('br.sp.abc.casa_x'), 'manual') $$,
  '23514', null,
  'house_accepted só aceita self ou questionnaire como forma'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason)
     values (pg_temp.person('p_q'), 'house_accepted', pg_temp.unit('br.sp.abc.casa_x'), 'questionnaire') $$,
  '23514', null,
  'house_accepted pelo questionário exige a versão do termo'
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

-- Só a casa: nenhuma coluna nem parâmetro recebe as respostas do questionário.
select set_eq(
  $$ select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'questionnaire_consents' $$,
  array['profile_id', 'term_version', 'consented_at'],
  'questionnaire_consents guarda só pessoa, versão do termo e data'
);
select is(
  (select pg_get_function_identity_arguments('public.accept_house(text, text, text)'::regprocedure)),
  'p_house_key text, p_join_method text, p_term_version text',
  'accept_house recebe só a casa, a forma de entrada e a versão do termo'
);
select is_empty(
  $$ select 1 from information_schema.columns
     where table_schema in ('public', 'app') and column_name ~ '(answer|resposta|temperament|score)' $$,
  'nenhuma coluna do banco guarda resposta, temperamento ou pontuação'
);
select ok(
  not has_function_privilege('authenticated', 'app.house_unit_for(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'app.region_anchor(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.accept_house(text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.record_questionnaire_consent(text)', 'execute'),
  'as regras internas não são chamáveis pela API; as RPCs são fechadas para anon'
);
select ok(
  not has_table_privilege('authenticated', 'public.questionnaire_consents', 'insert')
  and not has_table_privilege('authenticated', 'public.questionnaire_consents', 'update')
  and not has_table_privilege('authenticated', 'public.questionnaire_consents', 'delete')
  and not has_column_privilege('authenticated', 'public.unit_members', 'accepted_at', 'update')
  and not has_column_privilege('authenticated', 'public.unit_members', 'join_method', 'update')
  and not has_column_privilege('authenticated', 'public.unit_members', 'consent_version', 'update')
  and not has_column_privilege('authenticated', 'public.unit_members', 'ended_by', 'update'),
  'aceite, versão e quem encerrou só pelas funções e triggers (sem grant de escrita)'
);

select * from finish();
rollback;
