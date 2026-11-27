-- Lista de autorizados, primeiro login, fila de espera e auditoria (issue #26, ADR 0008 §1).
-- Testes obrigatórios do ADR: quem está `waitlisted` não lê nada além do próprio perfil;
-- e-mail fora da lista nunca vira `active` sem aprovação; o HMAC não é reversível pela
-- interface. Pessoas e HMACs fictícios, só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(127);

-- HMAC fictício (64 hex): o banco não calcula o HMAC de verdade, só guarda e compara.
create function pg_temp.h(p_tag text) returns text language sql as $$
  select encode(sha256(convert_to(p_tag, 'UTF8')), 'hex')
$$;
create function pg_temp.enc(p_tag text) returns text language sql as $$
  select 'v1.AAAAAAAAAAAAAAAA.' || rpad(p_tag, 22, 'x')
$$;

-- Unidades do seed (br > sp, mg). Os ids são lidos aqui, como dono do banco: depois de
-- trocar de papel, a RLS esconderia as unidades e o helper devolveria nulo.
select set_config('test.br', (select id::text from public.units where path = 'br'), true),
       set_config('test.sp', (select id::text from public.units where path = 'br.sp'), true),
       set_config('test.mg', (select id::text from public.units where path = 'br.mg'), true);
select isnt(nullif(current_setting('test.br', true), ''), null, 'unidade raiz do seed encontrada');
select isnt(nullif(current_setting('test.sp', true), ''), null, 'unidade de SP do seed encontrada');
select isnt(nullif(current_setting('test.mg', true), ''), null, 'unidade de MG do seed encontrada');

create temp table people (name text primary key, id uuid not null unique);
insert into people values
  ('root_mgr', '00000000-0000-0000-0000-0000000000c1'),  -- manager da raiz
  ('sp_mgr',   '00000000-0000-0000-0000-0000000000c2'),  -- manager de SP
  ('mg_mgr',   '00000000-0000-0000-0000-0000000000c3'),  -- manager de MG
  ('sp_mon',   '00000000-0000-0000-0000-0000000000c4'),  -- monitor de SP
  ('tech',     '00000000-0000-0000-0000-0000000000c5'),  -- admin técnico
  ('sp_mgr_w', '00000000-0000-0000-0000-0000000000c6'),  -- manager de SP, mas na espera
  ('member',   '00000000-0000-0000-0000-0000000000c7'),  -- ativo em SP, sem papel
  ('pend_in',  '00000000-0000-0000-0000-0000000000c8'),  -- pendente, e-mail na lista
  ('pend_out', '00000000-0000-0000-0000-0000000000c9'),  -- pendente, e-mail fora da lista
  ('wait_a',   '00000000-0000-0000-0000-0000000000ca'),  -- na espera em SP (será aprovado)
  ('wait_b',   '00000000-0000-0000-0000-0000000000cb'),  -- na espera em SP (será bloqueado)
  ('wait_mg',  '00000000-0000-0000-0000-0000000000cc'),  -- na espera em MG
  ('noprof',   '00000000-0000-0000-0000-0000000000cd');  -- logado, ainda sem perfil
insert into auth.users (id) select id from people;

-- Nome desconhecido falha (P0002) em vez de devolver nulo: um id nulo faria o teste negar o
-- acesso pelo motivo errado (#113).
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
grant select on people to authenticated;

insert into public.municipalities (code, name, state_code) values (3106200, 'Belo Horizonte', 'MG')
on conflict do nothing;

-- Perfis: o trigger põe cada um na unidade do seu estado (SP: 3550308; MG: 3106200).
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc(name),
       case when name in ('mg_mgr', 'wait_mg') then 3106200 else 3550308 end, 'v1'
from people where name <> 'noprof';
update public.profiles set access_status = 'active', status = 'active'
where id in (select id from people where name in ('root_mgr', 'sp_mgr', 'mg_mgr', 'sp_mon', 'tech', 'member'));
update public.profiles set access_status = 'waitlisted'
where id in (select id from people where name in ('sp_mgr_w', 'wait_a', 'wait_b', 'wait_mg'));

insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_mgr'), 'manager', current_setting('test.br')::uuid),
  (pg_temp.person('sp_mgr'), 'manager', current_setting('test.sp')::uuid),
  (pg_temp.person('mg_mgr'), 'manager', current_setting('test.mg')::uuid),
  (pg_temp.person('sp_mon'), 'monitor', current_setting('test.sp')::uuid),
  (pg_temp.person('tech'), 'tech_admin', current_setting('test.br')::uuid),
  (pg_temp.person('sp_mgr_w'), 'manager', current_setting('test.sp')::uuid);

select is(
  (select count(*)::int from public.unit_members
   where profile_id in (pg_temp.person('wait_a'), pg_temp.person('wait_mg')) and left_at is null),
  2,
  'quem está na espera tem vínculo com a unidade do seu estado (base do escopo da fila)'
);

-- Lista inicial: o e-mail de pend_in está nela.
insert into public.access_allowlist (email_hmac, source) values (pg_temp.h('pend_in@exemplo.org'), 'academy');

-- ---------------------------------------------------------------------------------------
-- Estrutura: só HMAC, nada em claro
-- ---------------------------------------------------------------------------------------
select columns_are('public', 'access_allowlist',
  array['id', 'email_hmac', 'source', 'added_by', 'added_at'],
  'access_allowlist tem exatamente as colunas do modelo de dados (sem e-mail nem nome)');
select columns_are('public', 'audit_log',
  array['id', 'actor_id', 'event', 'target_id', 'item_count', 'reason', 'term_version', 'house_key',
        'unit_id', 'grant_id', 'created_at'],
  'audit_log tem só ids, evento, quantidade, motivo, versão do termo, casa, unidade e concessão (estas só na delegação) e data');
select columns_are('public', 'access_waitlist_hmac',
  array['profile_id', 'email_hmac', 'created_at'],
  'access_waitlist_hmac tem só o perfil, o HMAC e a data');
select throws_ok(
  $$ insert into public.access_allowlist (email_hmac, source) values ('maria@exemplo.org', 'manual') $$,
  '23514', null,
  'a lista recusa e-mail em claro (só HMAC hex de 64 caracteres)'
);
select throws_ok(
  $$ insert into public.access_allowlist (email_hmac, source) values (pg_temp.h('x'), 'outro') $$,
  '23514', null,
  'origem fora de form/academy/manual é recusada'
);
select is_empty(
  $$ select format('%I.%I', c.table_schema, c.table_name) || '.' || c.column_name
     from information_schema.columns as c
     where c.table_schema in ('public', 'app')
       and c.column_name ~* 'e-?mail'
       and (c.table_name, c.column_name) not in
           (('access_allowlist', 'email_hmac'), ('access_waitlist_hmac', 'email_hmac')) $$,
  'nenhuma coluna de e-mail nas tabelas do app além dos dois email_hmac (só HMAC)'
);

-- ---------------------------------------------------------------------------------------
-- O HMAC não é reversível pela interface: nenhum papel da API lê a lista, e nenhuma
-- função exposta devolve HMAC ou e-mail.
-- ---------------------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'public.access_allowlist', 'select')
  and not has_table_privilege('anon', 'public.access_allowlist', 'select'),
  'nenhum papel da API tem SELECT na lista'
);
select ok(
  not has_table_privilege('authenticated', 'public.access_allowlist', 'insert, update, delete')
  and not has_table_privilege('anon', 'public.access_allowlist', 'insert, update, delete'),
  'nenhum papel da API grava na lista diretamente'
);
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app')
       and (has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('anon', p.oid, 'execute'))
       and (
         exists (select 1 from unnest(p.proargnames, p.proargmodes::text[]) as a(name, mode)
                 where a.mode in ('o', 't', 'b') and a.name ~* 'mail|hmac')
         or pg_get_function_result(p.oid) ~* 'mail|hmac'
       ) $$,
  'nenhuma função executável pela API devolve e-mail ou HMAC'
);
select ok(
  not has_function_privilege('anon', 'public.resolve_access(text)', 'execute')
  and not has_function_privilege('anon', 'public.import_allowlist(text[], text)', 'execute')
  and not has_function_privilege('anon', 'public.list_waitlist(integer, timestamptz, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.decide_access(uuid, text)', 'execute'),
  'visitante anônimo não executa nenhuma RPC de acesso'
);

set local role authenticated;
select pg_temp.login('root_mgr');
select throws_ok(
  $$ select 1 from public.access_allowlist $$,
  '42501', null,
  'nem o gestor da raiz lê a lista pela API'
);
select throws_ok(
  $$ insert into public.access_allowlist (email_hmac, source) values (pg_temp.h('z'), 'manual') $$,
  '42501', null,
  'nem o gestor da raiz insere direto na lista (só pela importação auditada)'
);

-- ---------------------------------------------------------------------------------------
-- Importação: só o gestor da raiz (fora do escopo → negado, R16)
-- ---------------------------------------------------------------------------------------
select pg_temp.login('sp_mgr');
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('a@x.org')], 'academy') $$,
  '42501', null,
  'gestor de estado NÃO importa a lista'
);
select pg_temp.login('sp_mon');
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('a@x.org')], 'academy') $$,
  '42501', null,
  'monitor NÃO importa a lista'
);
select pg_temp.login('tech');
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('a@x.org')], 'academy') $$,
  '42501', null,
  'admin técnico NÃO importa a lista'
);
select pg_temp.login('member');
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('a@x.org')], 'academy') $$,
  '42501', null,
  'membro sem papel NÃO importa a lista'
);
select pg_temp.login('wait_a');
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('a@x.org')], 'academy') $$,
  '42501', null,
  'quem está na espera NÃO importa a lista'
);

select pg_temp.login('root_mgr');
select throws_ok(
  $$ select public.import_allowlist(array['nao-e-hmac'], 'academy') $$,
  '22023', null,
  'importação recusa item que não é HMAC'
);
select throws_ok(
  $$ select public.import_allowlist(array[pg_temp.h('a@x.org')], 'planilha') $$,
  '22023', null,
  'importação recusa origem inválida'
);
select throws_ok(
  $$ select public.import_allowlist(array[]::text[], 'academy') $$,
  '22023', null,
  'importação recusa lista vazia'
);
select is(
  public.import_allowlist(
    array[pg_temp.h('a@x.org'), pg_temp.h('b@x.org'), pg_temp.h('a@x.org'), pg_temp.h('pend_in@exemplo.org')],
    'academy'),
  '{"received": 3, "promoted": 0}'::jsonb,
  'gestor da raiz importa: devolve a quantidade de HMACs distintos recebidos'
);
-- Um item que já estava na lista conta igual: a quantidade não revela quem já estava.
select is(
  (public.import_allowlist(array[pg_temp.h('pend_in@exemplo.org')], 'manual') ->> 'received')::int,
  1,
  'reimportar um HMAC que já estava na lista devolve 1 (não revela se era novo)'
);

reset role;
select is(
  (select count(*)::int from public.access_allowlist),
  3,
  'a lista tem 3 HMACs (duplicados descartados)'
);
select results_eq(
  $$ select actor_id, target_id, item_count from public.audit_log
     where event = 'allowlist_imported' order by id $$,
  $$ values ('00000000-0000-0000-0000-0000000000c1'::uuid, null::uuid, 3),
            ('00000000-0000-0000-0000-0000000000c1'::uuid, null::uuid, 1) $$,
  'cada importação gera allowlist_imported só com a quantidade'
);
select is(
  (select added_by from public.access_allowlist where email_hmac = pg_temp.h('a@x.org')),
  pg_temp.person('root_mgr'),
  'added_by é quem importou'
);
select is(
  (select count(*)::int from public.audit_log where event = 'allowlist_imported'),
  2,
  'importações negadas não geraram auditoria'
);

-- ---------------------------------------------------------------------------------------
-- Primeiro login
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('pend_in');
select is(public.resolve_access(pg_temp.h('pend_in@exemplo.org')), 'active',
  'pendente com e-mail na lista vira active');
select pg_temp.login('pend_out');
select is(public.resolve_access(pg_temp.h('pend_out@exemplo.org')), 'waitlisted',
  'pendente com e-mail fora da lista vira waitlisted');
-- Nova chamada, agora com um HMAC que está na lista: não decide de novo.
select is(public.resolve_access(pg_temp.h('a@x.org')), 'waitlisted',
  'e-mail fora da lista NUNCA vira active depois: a decisão é uma só');
select throws_ok(
  $$ select public.resolve_access('maria@exemplo.org') $$,
  '22023', null,
  'resolve_access recusa e-mail em claro (só HMAC)'
);
select pg_temp.login('member');
select is(public.resolve_access(pg_temp.h('qualquer@x.org')), 'active',
  'quem já está active continua active (a função não rebaixa nem consulta a lista)');
select pg_temp.login('wait_mg');
select is(public.resolve_access(pg_temp.h('a@x.org')), 'waitlisted',
  'quem está na espera não sai dela pelo login, nem com HMAC da lista');
select pg_temp.login('noprof');
select is(public.resolve_access(pg_temp.h('a@x.org')), null,
  'sem perfil, devolve nulo e não decide nada');

reset role;
select results_eq(
  $$ select p.name, pr.access_status, pr.status
     from people as p join public.profiles as pr on pr.id = p.id
     where p.name in ('pend_in', 'pend_out', 'member', 'wait_mg') order by p.name $$,
  $$ values ('member', 'active', 'active'), ('pend_in', 'active', 'active'),
            ('pend_out', 'waitlisted', 'pending'), ('wait_mg', 'waitlisted', 'pending') $$,
  'resolve_access só mudou o perfil de quem chamou, e só a partir de pending'
);
select is_empty(
  $$ select 1 from public.profiles where id = pg_temp.person('noprof') $$,
  'resolve_access não cria perfil'
);
select results_eq(
  $$ select profile_id, email_hmac from public.access_waitlist_hmac $$,
  $$ values (pg_temp.person('pend_out'), pg_temp.h('pend_out@exemplo.org')) $$,
  'quem foi para a espera no login tem o HMAC guardado (e só essa pessoa)'
);
-- Inserir direto na lista (sem a importação) e logar de novo não libera: só a importação
-- (que confere o HMAC guardado) ou o gestor.
insert into public.access_allowlist (email_hmac, source) values (pg_temp.h('pend_out@exemplo.org'), 'manual');
set local role authenticated;
select pg_temp.login('pend_out');
select is(public.resolve_access(pg_temp.h('pend_out@exemplo.org')), 'waitlisted',
  'logar de novo não libera, mesmo com o HMAC já na lista');
select throws_ok(
  $$ update public.profiles set access_status = 'active' where id = (select auth.uid()) $$,
  '42501', null,
  'quem está na espera não muda o próprio access_status direto na tabela'
);

-- ---------------------------------------------------------------------------------------
-- Quem está na espera lê só o próprio perfil e não aparece para ninguém
-- ---------------------------------------------------------------------------------------
select pg_temp.login('wait_a');
select set_eq(
  $$ select id from public.profiles $$,
  array[pg_temp.person('wait_a')],
  'na espera: lê só o próprio perfil'
);
select is_empty($$ select 1 from public.profile_contacts where profile_id <> (select auth.uid()) $$,
  'na espera: não lê contato de ninguém');
select is_empty($$ select 1 from public.municipalities $$, 'na espera: não lê municípios');
select is_empty($$ select 1 from public.unit_types $$, 'na espera: não lê tipos de unidade');
select is_empty($$ select 1 from public.units $$, 'na espera: não lê unidades');
select is_empty($$ select 1 from public.unit_members $$, 'na espera: não lê vínculos');
select is_empty($$ select 1 from public.role_assignments $$, 'na espera: não lê papéis');
select is_empty($$ select 1 from public.audit_log $$, 'na espera: não lê auditoria');
select is_empty($$ select 1 from public.list_waitlist() $$, 'na espera: não vê a fila');
select throws_ok($$ select 1 from public.access_allowlist $$, '42501', null,
  'na espera: não lê a lista');

select pg_temp.login('sp_mgr');
select is_empty(
  $$ select 1 from public.profiles
     where id in (pg_temp.person('wait_a'), pg_temp.person('wait_b'), pg_temp.person('pend_out')) $$,
  'quem está na espera não aparece na busca de perfis do gestor'
);

-- O gestor de SP, mas na espera: o papel não vale para a fila
select pg_temp.login('sp_mgr_w');
select is_empty($$ select 1 from public.list_waitlist() $$,
  'gestor na espera não vê a fila');
select throws_ok(
  $$ select public.decide_access(pg_temp.person('wait_a'), 'active') $$,
  '42501', null,
  'gestor na espera NÃO aprova ninguém'
);

-- ---------------------------------------------------------------------------------------
-- Fila de espera e decisões
-- ---------------------------------------------------------------------------------------
select pg_temp.login('sp_mgr');
select set_eq(
  $$ select profile_id from public.list_waitlist() $$,
  $$ select id from people where name in ('wait_a', 'wait_b', 'pend_out', 'sp_mgr_w') $$,
  'gestor de SP vê a fila de SP (NÃO a de MG nem quem não está na espera)'
);
select pg_temp.login('mg_mgr');
select set_eq(
  $$ select profile_id from public.list_waitlist() $$,
  array[pg_temp.person('wait_mg')],
  'gestor de MG vê só a fila de MG'
);
select throws_ok(
  $$ select public.decide_access(pg_temp.person('wait_a'), 'active') $$,
  '42501', null,
  'gestor de MG NÃO aprova quem está na espera em SP (fora do escopo)'
);
select pg_temp.login('sp_mon');
select throws_ok(
  $$ select public.decide_access(pg_temp.person('wait_a'), 'active') $$,
  '42501', null,
  'monitor NÃO aprova (só o gestor)'
);
select pg_temp.login('tech');
select throws_ok(
  $$ select public.decide_access(pg_temp.person('wait_a'), 'active') $$,
  '42501', null,
  'admin técnico NÃO aprova'
);
select pg_temp.login('member');
select throws_ok(
  $$ select public.decide_access(pg_temp.person('wait_a'), 'active') $$,
  '42501', null,
  'membro sem papel NÃO aprova'
);

reset role;
select is(
  (select access_status from public.profiles where id = pg_temp.person('wait_a')),
  'waitlisted',
  'as tentativas negadas não mudaram o perfil'
);
select is_empty(
  $$ select 1 from public.audit_log where event in ('access_granted', 'access_blocked') $$,
  'as tentativas negadas não geraram auditoria'
);

set local role authenticated;
select pg_temp.login('sp_mgr');
select throws_ok(
  $$ select public.decide_access(pg_temp.person('wait_a'), 'pending') $$,
  '22023', null,
  'decisão só pode ser active ou blocked'
);
select throws_ok(
  $$ select public.decide_access(pg_temp.person('member'), 'blocked') $$,
  '42501', null,
  'a fila não bloqueia quem já está ativo (só quem está na espera)'
);
select throws_ok(
  $$ select public.decide_access('00000000-0000-0000-0000-0000000000ff', 'active') $$,
  '42501', null,
  'perfil inexistente dá o mesmo erro (sem oráculo)'
);
select is(public.decide_access(pg_temp.person('wait_a'), 'active'), 'active',
  'gestor de SP aprova quem está na espera em SP');
select is(public.decide_access(pg_temp.person('wait_b'), 'blocked'), 'blocked',
  'gestor de SP bloqueia quem está na espera em SP');
select throws_ok(
  $$ select public.decide_access(pg_temp.person('wait_a'), 'blocked') $$,
  '42501', null,
  'depois de decidido, o perfil sai da fila'
);
select set_eq(
  $$ select id from public.profiles where id in (pg_temp.person('wait_a'), pg_temp.person('wait_b')) $$,
  array[pg_temp.person('wait_a')],
  'aprovado passa a aparecer para o gestor; bloqueado não'
);

reset role;
select results_eq(
  $$ select access_status, status from public.profiles
     where id in (pg_temp.person('wait_a'), pg_temp.person('wait_b')) order by id $$,
  $$ values ('active', 'active'), ('blocked', 'pending') $$,
  'aprovado fica active (e a conta, ativa); bloqueado fica blocked'
);
select results_eq(
  $$ select event, actor_id, target_id, item_count from public.audit_log
     where event in ('access_granted', 'access_blocked') order by id $$,
  $$ values ('access_granted', '00000000-0000-0000-0000-0000000000c2'::uuid,
             '00000000-0000-0000-0000-0000000000ca'::uuid, null::integer),
            ('access_blocked', '00000000-0000-0000-0000-0000000000c2'::uuid,
             '00000000-0000-0000-0000-0000000000cb'::uuid, null::integer) $$,
  'cada decisão gera access_granted / access_blocked com quem decidiu e o alvo'
);

-- ---------------------------------------------------------------------------------------
-- Auditoria: só leitura, só gestores, só no escopo
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('root_mgr');
select set_eq(
  $$ select event from public.audit_log $$,
  array['allowlist_imported', 'access_granted', 'access_blocked'],
  'gestor da raiz lê importações e decisões'
);
select throws_ok(
  $$ insert into public.audit_log (actor_id, event, target_id)
     values ((select auth.uid()), 'access_granted', pg_temp.person('wait_mg')) $$,
  '42501', null,
  'ninguém grava na auditoria pela API'
);
select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null,
  'ninguém apaga a auditoria pela API'
);
select pg_temp.login('sp_mgr');
select set_eq(
  $$ select event from public.audit_log $$,
  array['access_granted', 'access_blocked'],
  'gestor de SP lê as decisões de SP, NÃO as importações'
);
select pg_temp.login('mg_mgr');
select is_empty($$ select 1 from public.audit_log $$,
  'gestor de MG NÃO lê a auditoria de SP (fora do escopo)');
select pg_temp.login('sp_mon');
select is_empty($$ select 1 from public.audit_log $$, 'monitor NÃO lê a auditoria');
select pg_temp.login('tech');
select is_empty($$ select 1 from public.audit_log $$, 'admin técnico NÃO lê a auditoria');
select pg_temp.login('wait_a');
select is_empty($$ select 1 from public.audit_log $$,
  'quem foi aprovado NÃO lê a auditoria sobre si');

-- ---------------------------------------------------------------------------------------
-- Revisão do PR #114: guardas de quem chama, entradas inválidas e casos de borda
-- ---------------------------------------------------------------------------------------
reset role;
-- Sem JWT: o trigger de bootstrap da raiz só vale para chamadas da API.
select set_config('request.jwt.claims', '', true);
insert into public.municipalities (code, name, state_code) values (3304557, 'Rio de Janeiro', 'RJ')
on conflict do nothing;
insert into people values
  ('root_wait',   '00000000-0000-0000-0000-0000000000d1'),  -- manager da raiz, na espera
  ('root_blk',    '00000000-0000-0000-0000-0000000000d2'),  -- manager da raiz, bloqueado
  ('root_susp',   '00000000-0000-0000-0000-0000000000d3'),  -- manager da raiz, conta suspensa
  ('sp_mgr_susp', '00000000-0000-0000-0000-0000000000d4'),  -- manager de SP, conta suspensa
  ('wait_nounit', '00000000-0000-0000-0000-0000000000d5'),  -- na espera, sem unidade (RJ)
  ('blk',         '00000000-0000-0000-0000-0000000000d6'),  -- bloqueado
  ('pend_susp',   '00000000-0000-0000-0000-0000000000d7');  -- pendente, conta suspensa
insert into auth.users (id) select id from people where name in
  ('root_wait', 'root_blk', 'root_susp', 'sp_mgr_susp', 'wait_nounit', 'blk', 'pend_susp');
-- RJ não tem unidade de estado: essas pessoas ficam sem vínculo.
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc(name), case when name = 'sp_mgr_susp' then 3550308 else 3304557 end, 'v1'
from people where name in ('root_wait', 'root_blk', 'root_susp', 'sp_mgr_susp', 'wait_nounit', 'blk', 'pend_susp');
update public.profiles set access_status = 'waitlisted' where id in (pg_temp.person('root_wait'), pg_temp.person('wait_nounit'));
update public.profiles set access_status = 'blocked', status = 'active' where id in (pg_temp.person('root_blk'), pg_temp.person('blk'));
update public.profiles set access_status = 'active', status = 'suspended'
where id in (pg_temp.person('root_susp'), pg_temp.person('sp_mgr_susp'));
update public.profiles set status = 'suspended' where id = pg_temp.person('pend_susp');
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('root_wait'), 'manager', current_setting('test.br')::uuid),
  (pg_temp.person('root_blk'), 'manager', current_setting('test.br')::uuid),
  (pg_temp.person('root_susp'), 'manager', current_setting('test.br')::uuid),
  (pg_temp.person('sp_mgr_susp'), 'manager', current_setting('test.sp')::uuid);
-- Registro de auditoria sobre o próprio gestor de SP (para o teste "não lê sobre si").
insert into public.audit_log (actor_id, event, target_id, reason)
values (pg_temp.person('root_mgr'), 'access_granted', pg_temp.person('sp_mgr'), 'manual');
select is(
  (select count(*)::int from public.unit_members where profile_id = pg_temp.person('wait_nounit')),
  0,
  'a pessoa na espera do RJ não tem vínculo nenhum'
);

-- Gestor da raiz fora de active/active não importa
set local role authenticated;
select pg_temp.login('root_wait');
select throws_ok($$ select public.import_allowlist(array[pg_temp.h('q@x.org')], 'manual') $$,
  '42501', null, 'gestor da raiz na espera NÃO importa');
select pg_temp.login('root_blk');
select throws_ok($$ select public.import_allowlist(array[pg_temp.h('q@x.org')], 'manual') $$,
  '42501', null, 'gestor da raiz bloqueado NÃO importa');
select pg_temp.login('root_susp');
select throws_ok($$ select public.import_allowlist(array[pg_temp.h('q@x.org')], 'manual') $$,
  '42501', null, 'gestor da raiz com conta suspensa NÃO importa');

-- Gestor com conta suspensa não lista nem decide
select pg_temp.login('sp_mgr_susp');
select is_empty($$ select 1 from public.list_waitlist() $$, 'gestor suspenso NÃO vê a fila');
select throws_ok($$ select public.decide_access(pg_temp.person('pend_out'), 'active') $$,
  '42501', null, 'gestor suspenso NÃO decide');

-- Gestor não lê a auditoria sobre si mesmo
select pg_temp.login('sp_mgr');
select is(app.can_read_audit('access_granted', pg_temp.person('sp_mgr')), false,
  'can_read_audit: gestor NÃO lê registro sobre si mesmo');
select is_empty($$ select 1 from public.audit_log where target_id = pg_temp.person('sp_mgr') $$,
  'gestor de SP NÃO vê a linha de auditoria sobre si');

-- Na espera sem unidade: só o gestor da raiz decide
select throws_ok($$ select public.decide_access(pg_temp.person('wait_nounit'), 'active') $$,
  '42501', null, 'gestor de SP NÃO decide sobre quem está na espera sem unidade');
select pg_temp.login('root_mgr');
select is(public.decide_access(pg_temp.person('wait_nounit'), 'active'), 'active',
  'gestor da raiz decide sobre quem está na espera sem unidade');

-- Entradas inválidas
select throws_ok($$ select public.import_allowlist(array[pg_temp.h('q@x.org')], null) $$,
  '22023', null, 'importação recusa origem nula');
select throws_ok($$ select public.import_allowlist(array[pg_temp.h('q@x.org'), null], 'manual') $$,
  '22023', null, 'importação recusa item nulo no meio da lista');
select throws_ok($$ select public.import_allowlist(null, 'manual') $$,
  '22023', null, 'importação recusa lista nula');
select throws_ok(
  $$ select public.import_allowlist(array_fill(pg_temp.h('q@x.org'), array[50001]), 'manual') $$,
  '22023', null, 'importação recusa mais de 50000 itens');
select pg_temp.login('pend_in');
select throws_ok($$ select public.resolve_access(null) $$, '22023', null, 'resolve_access recusa HMAC nulo');
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$ select public.resolve_access(pg_temp.h('a@x.org')) $$,
  '42501', null, 'resolve_access sem sessão (sem sub) é recusado');

-- Bloqueado e suspenso: o login não muda o que a coordenação decidiu
select pg_temp.login('blk');
select is(public.resolve_access(pg_temp.h('a@x.org')), 'blocked',
  'bloqueado continua bloqueado, mesmo com HMAC da lista');
select pg_temp.login('pend_susp');
select is(public.resolve_access(pg_temp.h('a@x.org')), 'active',
  'pendente com conta suspensa: a lista libera o acesso...');
reset role;
select results_eq(
  $$ select p.name, pr.access_status, pr.status from people as p
     join public.profiles as pr on pr.id = p.id
     where p.name in ('blk', 'pend_susp') order by p.name $$,
  $$ values ('blk', 'blocked', 'active'), ('pend_susp', 'active', 'suspended') $$,
  '...mas a conta suspensa continua suspensa, e o bloqueado não mudou'
);

-- Paginação da fila (mais antigos primeiro). As datas são acertadas como dono do banco, com
-- o trigger que fixa created_at desligado só nesta transação.
alter table public.profiles disable trigger profiles_before_write;
update public.profiles set created_at = '2026-01-02T00:00:00Z' where id = pg_temp.person('pend_out');
update public.profiles set created_at = '2026-01-01T00:00:00Z' where id = pg_temp.person('sp_mgr_w');
alter table public.profiles enable trigger profiles_before_write;
set local role authenticated;
select pg_temp.login('sp_mgr');
select results_eq(
  $$ select profile_id from public.list_waitlist(p_limit => 1) $$,
  array[pg_temp.person('sp_mgr_w')],
  'primeira página (limite 1) traz o mais antigo'
);
select results_eq(
  $$ select profile_id from public.list_waitlist(1, '2026-01-01T00:00:00Z', pg_temp.person('sp_mgr_w')) $$,
  array[pg_temp.person('pend_out')],
  'o cursor do último item traz o seguinte'
);
select is_empty(
  $$ select 1 from public.list_waitlist(1, '2026-01-02T00:00:00Z', pg_temp.person('pend_out')) $$,
  'depois do último, a fila acaba'
);
select throws_ok($$ select * from public.list_waitlist(0) $$, '22023', null, 'limite 0 é recusado');
select throws_ok($$ select * from public.list_waitlist(201) $$, '22023', null, 'limite acima de 200 é recusado');
select throws_ok($$ select * from public.list_waitlist(10, now(), null) $$, '22023', null,
  'cursor incompleto é recusado');

-- ---------------------------------------------------------------------------------------
-- Liberação automática na importação (aprovada pelo gestor em 2026-11-19)
-- ---------------------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
insert into people values
  ('pw_a',     '00000000-0000-0000-0000-0000000000e1'),  -- espera em SP; será importado
  ('pw_blk',   '00000000-0000-0000-0000-0000000000e2'),  -- espera, depois bloqueado
  ('pw_susp',  '00000000-0000-0000-0000-0000000000e3'),  -- espera, conta suspensa
  ('pw_other', '00000000-0000-0000-0000-0000000000e4');  -- espera, fora da importação
insert into auth.users (id) select id from people where name like 'pw\_%';
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, pg_temp.enc(name), case when name = 'pw_a' then 3550308 else 3304557 end, 'v1'
from people where name like 'pw\_%';
set local role authenticated;
select pg_temp.login('pw_a');
select is(public.resolve_access(pg_temp.h('pw_a@x.org')), 'waitlisted', 'pw_a vai para a espera');
select pg_temp.login('pw_blk');
select is(public.resolve_access(pg_temp.h('pw_blk@x.org')), 'waitlisted', 'pw_blk vai para a espera');
select pg_temp.login('pw_susp');
select is(public.resolve_access(pg_temp.h('pw_susp@x.org')), 'waitlisted', 'pw_susp vai para a espera');
select pg_temp.login('pw_other');
select is(public.resolve_access(pg_temp.h('pw_other@x.org')), 'waitlisted', 'pw_other vai para a espera');
-- Bloqueio e suspensão feitos fora da fila (a linha guardada continua): a importação
-- também precisa respeitar os dois.
reset role;
update public.profiles set access_status = 'blocked' where id = pg_temp.person('pw_blk');
update public.profiles set status = 'suspended' where id = pg_temp.person('pw_susp');

-- Nenhum papel da API lê a tabela dos HMACs da espera
select ok(
  not has_table_privilege('authenticated', 'public.access_waitlist_hmac', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.access_waitlist_hmac', 'select, insert, update, delete'),
  'nenhum papel da API tem privilégio em access_waitlist_hmac'
);
set local role authenticated;
select pg_temp.login('root_mgr');
select throws_ok($$ select 1 from public.access_waitlist_hmac $$, '42501', null,
  'nem o gestor da raiz lê os HMACs da espera');
select pg_temp.login('pw_a');
select throws_ok($$ select 1 from public.access_waitlist_hmac $$, '42501', null,
  'quem está na espera não lê nem o próprio HMAC guardado');

-- Importação sem nenhum HMAC da espera: nada muda
select pg_temp.login('root_mgr');
select is(public.import_allowlist(array[pg_temp.h('ninguem@x.org')], 'manual'),
  '{"received": 1, "promoted": 0}'::jsonb,
  'importação sem HMAC da espera não libera ninguém');
reset role;
select is((select count(*)::int from public.access_waitlist_hmac
           where profile_id in (select id from people where name like 'pw\_%')), 4,
  'as quatro linhas da espera continuam');

-- Importação com os HMACs: só quem está em waitlisted e com a conta não suspensa é liberado
set local role authenticated;
select pg_temp.login('root_mgr');
select is(
  public.import_allowlist(
    array[pg_temp.h('pw_a@x.org'), pg_temp.h('pw_blk@x.org'), pg_temp.h('pw_susp@x.org'), pg_temp.h('novo@x.org')],
    'academy'),
  '{"received": 4, "promoted": 1}'::jsonb,
  'importação devolve recebidos e liberados'
);
reset role;
select results_eq(
  $$ select p.name, pr.access_status, pr.status from people as p
     join public.profiles as pr on pr.id = p.id
     where p.name like 'pw\_%' order by p.name $$,
  $$ values ('pw_a', 'active', 'active'), ('pw_blk', 'blocked', 'pending'),
            ('pw_other', 'waitlisted', 'pending'), ('pw_susp', 'waitlisted', 'suspended') $$,
  'na espera e importado vira active; bloqueado, suspenso e não importado não mudam'
);
select set_eq(
  $$ select profile_id from public.access_waitlist_hmac
     where profile_id in (select id from people where name like 'pw\_%') $$,
  $$ select id from people where name in ('pw_blk', 'pw_susp', 'pw_other') $$,
  'a linha de quem foi liberado some; as outras ficam'
);
select results_eq(
  $$ select actor_id, target_id, reason from public.audit_log
     where event = 'access_granted' and reason = 'import' $$,
  $$ values (pg_temp.person('root_mgr'), pg_temp.person('pw_a'), 'import'::text) $$,
  'um access_granted por pessoa liberada, com motivo import e quem importou'
);
select results_eq(
  $$ select item_count from public.audit_log where event = 'allowlist_imported' order by id desc limit 1 $$,
  array[4],
  'a importação continua auditada só com a quantidade recebida'
);
set local role authenticated;
select pg_temp.login('sp_mgr');
select ok(
  exists (select 1 from public.audit_log where target_id = pg_temp.person('pw_a') and reason = 'import'),
  'o gestor de SP vê, no seu escopo, quem foi liberado pela importação'
);

-- Decisão manual apaga a linha guardada
select pg_temp.login('root_mgr');
select is(public.decide_access(pg_temp.person('pw_other'), 'blocked'), 'blocked',
  'gestor da raiz bloqueia pw_other (sem unidade)');
reset role;
select is_empty(
  $$ select 1 from public.access_waitlist_hmac where profile_id = pg_temp.person('pw_other') $$,
  'decisão manual apaga o HMAC guardado'
);
select is(
  (select reason from public.audit_log where target_id = pg_temp.person('pw_other') and event = 'access_blocked'),
  'manual',
  'decisão pela fila é auditada com motivo manual'
);

-- A auditoria só aceita inserções, nem o dono do banco altera ou apaga
reset role;
select throws_ok($$ update public.audit_log set event = 'export' $$, '42501', 'audit_log só aceita inserções',
  'dono do banco NÃO altera a auditoria');
select throws_ok($$ delete from public.audit_log $$, '42501', 'audit_log só aceita inserções',
  'dono do banco NÃO apaga a auditoria');
select throws_ok($$ truncate public.audit_log $$, '42501', 'audit_log só aceita inserções',
  'dono do banco NÃO esvazia a auditoria');
select lives_ok(
  $$ insert into public.audit_log (actor_id, event, target_id, reason)
     values (pg_temp.person('root_mgr'), 'access_blocked', pg_temp.person('blk'), 'manual') $$,
  'inserir continua permitido'
);

reset role;
select * from finish();
rollback;
