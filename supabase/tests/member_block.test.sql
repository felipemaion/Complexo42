-- Bloquear e desbloquear quem já está ativo (issue #26, ADR 0008 §1).
-- `block_member` / `unblock_member`: só o gestor (manager) no escopo, nunca a si nem quem tem
-- papel no seu nível ou acima; resposta neutra (não revela se a conta existe); auditado; e o
-- efeito é imediato: quem é bloqueado deixa de ver e de ser visto. Pessoas fictícias, só
-- dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(75);

-- Unidades do seed (br > sp > abc; br > mg), lidas como dono antes de trocar de papel.
create temp table unit_ids (slug text primary key, id uuid not null);
insert into unit_ids select slug, id from public.units where path::text in ('br', 'br.sp', 'br.sp.abc', 'br.mg');
select is((select count(*)::int from unit_ids), 4, 'unidades do seed encontradas');
create function pg_temp.unit(p_slug text) returns uuid language sql stable as $$
  select id from unit_ids where slug = p_slug
$$;

create temp table people (name text primary key, id uuid not null unique, email text not null);
insert into people values
  ('sp_mgr',    '00000000-0000-0000-0000-0000000000d1', 'sp.mgr@exemplo.org'),    -- manager de SP
  ('abc_mgr',   '00000000-0000-0000-0000-0000000000d2', 'abc.mgr@exemplo.org'),   -- manager do ABC
  ('mg_mgr',    '00000000-0000-0000-0000-0000000000d3', 'mg.mgr@exemplo.org'),    -- manager de MG
  ('boss',      '00000000-0000-0000-0000-0000000000d4', 'boss@exemplo.org'),      -- no ABC, manager de SP
  ('peer',      '00000000-0000-0000-0000-0000000000d5', 'peer@exemplo.org'),      -- no ABC, monitor do ABC
  ('member',    '00000000-0000-0000-0000-0000000000d6', 'member@exemplo.org'),    -- ativo no ABC
  ('member2',   '00000000-0000-0000-0000-0000000000d7', 'member2@exemplo.org'),   -- ativo no ABC
  ('wait',      '00000000-0000-0000-0000-0000000000d8', 'wait@exemplo.org'),      -- no ABC, na espera
  ('blocked',   '00000000-0000-0000-0000-0000000000d9', 'blocked@exemplo.org'),   -- no ABC, bloqueado
  ('abc_mgr_w', '00000000-0000-0000-0000-0000000000da', 'abc.mgr.w@exemplo.org'), -- manager do ABC, na espera
  ('sp_mon',    '00000000-0000-0000-0000-0000000000db', 'sp.mon@exemplo.org'),    -- monitor de SP
  ('tech',      '00000000-0000-0000-0000-0000000000dc', 'tech@exemplo.org'),      -- admin técnico, em SP
  ('plain',     '00000000-0000-0000-0000-0000000000dd', 'plain@exemplo.org'),     -- ativo, sem papel
  ('root_mgr',  '00000000-0000-0000-0000-0000000000de', 'root.mgr@exemplo.org'),  -- manager da raiz
  ('root_mgr2', '00000000-0000-0000-0000-0000000000df', 'root.mgr2@exemplo.org'), -- outro manager da raiz
  ('hc_root',   '00000000-0000-0000-0000-0000000000e0', 'hc.root@exemplo.org'),   -- coordenador nacional de casa
  ('two_roles', '00000000-0000-0000-0000-0000000000e1', 'two.roles@exemplo.org'); -- no ABC; monitor do ABC e de MG
insert into auth.users (id, email) select id, email from people;

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
grant select on people, unit_ids to authenticated;

-- Perfis em SP (o trigger põe cada um na unidade de SP); MG para o gestor de MG.
insert into public.municipalities (code, name, state_code) values (3106200, 'Belo Horizonte', 'MG')
on conflict do nothing;
insert into public.profiles (id, display_name_enc, municipality_code, consent_version)
select id, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB',
       case when name = 'mg_mgr' then 3106200 else 3550308 end, 'v1'
from people;
update public.profiles set access_status = 'active', status = 'active'
where id in (select id from people);
update public.profiles set access_status = 'waitlisted'
where id in (select id from people where name in ('wait', 'abc_mgr_w'));
update public.profiles set access_status = 'blocked' where id = pg_temp.person('blocked');

-- Quem é "do ABC" sai da unidade de SP e entra no ABC.
update public.unit_members set left_at = now()
where left_at is null
  and profile_id in (select id from people
                     where name in ('abc_mgr', 'boss', 'peer', 'member', 'member2', 'wait', 'blocked', 'two_roles'));
insert into public.unit_members (unit_id, profile_id)
select pg_temp.unit('abc'), id from people
where name in ('abc_mgr', 'boss', 'peer', 'member', 'member2', 'wait', 'blocked', 'two_roles');

insert into public.houses (key, active) values ('casa-t1', true)
on conflict (key) do update set active = excluded.active;
insert into public.role_assignments (profile_id, role, unit_id, house_key) values
  (pg_temp.person('hc_root'), 'house_coordinator', pg_temp.unit('br'), 'casa-t1');
insert into public.role_assignments (profile_id, role, unit_id) values
  (pg_temp.person('sp_mgr'), 'manager', pg_temp.unit('sp')),
  (pg_temp.person('abc_mgr'), 'manager', pg_temp.unit('abc')),
  (pg_temp.person('mg_mgr'), 'manager', pg_temp.unit('mg')),
  (pg_temp.person('boss'), 'manager', pg_temp.unit('sp')),
  (pg_temp.person('peer'), 'monitor', pg_temp.unit('abc')),
  (pg_temp.person('abc_mgr_w'), 'manager', pg_temp.unit('abc')),
  (pg_temp.person('sp_mon'), 'monitor', pg_temp.unit('sp')),
  (pg_temp.person('tech'), 'tech_admin', pg_temp.unit('br')),
  (pg_temp.person('root_mgr'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('root_mgr2'), 'manager', pg_temp.unit('br')),
  (pg_temp.person('two_roles'), 'monitor', pg_temp.unit('abc')),
  (pg_temp.person('two_roles'), 'monitor', pg_temp.unit('mg'));

create function pg_temp.status_of(p_name text) returns text language sql stable as $$
  select access_status from public.profiles where id = pg_temp.person(p_name)
$$;
create function pg_temp.audits(p_event text, p_name text) returns int language sql stable as $$
  select count(*)::int from public.audit_log where event = p_event and target_id = pg_temp.person(p_name)
$$;

-- ---------------------------------------------------------------------------------------
-- Quem não pode usar o bloqueio recebe 42501 (não depende do alvo)
-- ---------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.block_member('member@exemplo.org') $$, '42501', null,
  'anônimo NÃO bloqueia');
select throws_ok($$ select public.unblock_member('blocked@exemplo.org') $$, '42501', null,
  'anônimo NÃO desbloqueia');

set local role authenticated;
select pg_temp.login('plain');
select throws_ok($$ select public.block_member('member@exemplo.org') $$, '42501', null,
  'membro sem papel NÃO bloqueia');
select pg_temp.login('sp_mon');
select throws_ok($$ select public.block_member('member@exemplo.org') $$, '42501', null,
  'monitor NÃO bloqueia (só o gestor)');
select pg_temp.login('abc_mgr_w');
select throws_ok($$ select public.block_member('member@exemplo.org') $$, '42501', null,
  'gestor que está na espera NÃO bloqueia');
select pg_temp.login('tech');
select throws_ok($$ select public.block_member('member@exemplo.org') $$, '42501', null,
  'admin técnico NÃO bloqueia (sem escopo de dados)');
select pg_temp.login('member');
select throws_ok($$ select public.unblock_member('blocked@exemplo.org') $$, '42501', null,
  'membro sem papel NÃO desbloqueia');

-- Entrada inválida é recusada antes de procurar alguém.
select pg_temp.login('abc_mgr');
select throws_ok($$ select public.block_member('Member@Exemplo.org') $$, '22023', null,
  'e-mail fora do formato normalizado é recusado');
select throws_ok($$ select public.block_member('member@exemplo.org', 'qualquer texto') $$, '22023', null,
  'motivo fora da lista fechada é recusado (nada de texto livre)');

reset role;
select is(pg_temp.status_of('member'), 'active', 'nas recusas acima, ninguém foi bloqueado');

-- ---------------------------------------------------------------------------------------
-- No escopo: bloqueia, com auditoria e motivo opcional
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('abc_mgr');
select is((select count(*)::int from public.profiles where id = pg_temp.person('member')), 1,
  'antes do bloqueio, o gestor do ABC vê o perfil de member');
select lives_ok($$ select public.block_member('member@exemplo.org', 'impersonation') $$,
  'gestor do ABC bloqueia quem está ativo no ABC');
select is((select count(*)::int from public.profiles where id = pg_temp.person('member')), 0,
  'quem foi bloqueado some na hora para a coordenação (deixa de ser visto)');
select is((select count(*)::int from public.audit_log
           where event = 'member_blocked' and target_id = pg_temp.person('member')
             and actor_id = pg_temp.person('abc_mgr') and reason = 'impersonation'), 1,
  'o gestor lê o member_blocked do seu escopo, com o motivo');

select pg_temp.login('member');
select is(app.is_active_member(), false, 'quem foi bloqueado deixa de ser membro ativo na hora');

select pg_temp.login('mg_mgr');
select is((select count(*)::int from public.audit_log where target_id = pg_temp.person('member')), 0,
  'gestor de fora do escopo não lê a auditoria do bloqueio');

reset role;
select is(pg_temp.status_of('member'), 'blocked', 'access_status virou blocked');

-- Gestor de SP bloqueia o gestor do ABC (papel abaixo do seu), sem motivo.
set local role authenticated;
select pg_temp.login('abc_mgr');
select is((select count(*)::int from public.profiles where id = pg_temp.person('member2')), 1,
  'antes de ser bloqueado, o gestor do ABC vê member2');
select pg_temp.login('sp_mgr');
select lives_ok($$ select public.block_member('abc.mgr@exemplo.org') $$,
  'gestor de SP bloqueia o gestor do ABC (papel abaixo do seu), sem motivo');
select pg_temp.login('abc_mgr');
select is(app.is_active_member(), false, 'o gestor bloqueado perde o escopo na hora');
select is((select count(*)::int from public.profiles where id = pg_temp.person('member2')), 0,
  'o gestor bloqueado deixa de ver os perfis do ABC');
select is((select count(*)::int from public.unit_members), 0,
  'o gestor bloqueado deixa de ver os vínculos');
reset role;
select is((select reason from public.audit_log
           where event = 'member_blocked' and target_id = pg_temp.person('abc_mgr')), null,
  'sem motivo, o member_blocked grava reason nulo');

-- ---------------------------------------------------------------------------------------
-- Negados: mesma resposta (nada), nenhuma mudança, nenhuma auditoria
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('mg_mgr');
select lives_ok($$ select public.block_member('member2@exemplo.org') $$,
  'fora do escopo: a resposta é a mesma (sem erro)');
reset role;
select is(pg_temp.status_of('member2'), 'active', 'fora do escopo → negado (member2 segue ativo)');
select is(pg_temp.audits('member_blocked', 'member2'), 0, 'fora do escopo: nenhuma auditoria');

-- Para o gestor do ABC: peer (monitor do ABC) está no mesmo nível; boss (manager de SP), acima.
update public.profiles set access_status = 'active' where id = pg_temp.person('abc_mgr');
set local role authenticated;
select pg_temp.login('abc_mgr');
select lives_ok($$ select public.block_member('boss@exemplo.org') $$, 'acima: a resposta é a mesma');
select lives_ok($$ select public.block_member('peer@exemplo.org') $$, 'mesmo nível: a resposta é a mesma');
select lives_ok($$ select public.block_member('abc.mgr@exemplo.org') $$, 'a si mesmo: a resposta é a mesma');
select lives_ok($$ select public.block_member('wait@exemplo.org') $$, 'em espera: a resposta é a mesma');
select lives_ok($$ select public.block_member('ninguem@exemplo.org') $$,
  'e-mail sem conta: a resposta é a mesma (não revela se a pessoa existe)');
reset role;
select is(pg_temp.status_of('boss'), 'active', 'quem tem papel acima → negado');
select is(pg_temp.status_of('peer'), 'active', 'quem tem papel no mesmo nível → negado');
select is(pg_temp.status_of('abc_mgr'), 'active', 'a si mesmo → negado');
select is(pg_temp.status_of('wait'), 'waitlisted', 'em espera → negado (quem espera é decidido na fila)');
select is((select count(*)::int from public.audit_log
           where actor_id = pg_temp.person('abc_mgr')
             and event in ('member_blocked', 'member_unblocked')
             and target_id <> pg_temp.person('member')), 0,
  'nenhum dos negados gerou auditoria');

-- O gestor acima bloqueia quem o gestor do ABC não podia.
set local role authenticated;
select pg_temp.login('sp_mgr');
select lives_ok($$ select public.block_member('peer@exemplo.org', 'conduct') $$,
  'gestor de SP bloqueia o monitor do ABC');
select lives_ok($$ select public.block_member('tech@exemplo.org') $$, 'admin técnico: a resposta é a mesma');
select lives_ok($$ select public.block_member('boss@exemplo.org') $$,
  'colega manager de SP: a resposta é a mesma');
reset role;
select is(pg_temp.status_of('peer'), 'blocked', 'gestor de SP bloqueou o monitor do ABC');
select is(pg_temp.status_of('tech'), 'active', 'admin técnico (papel na raiz) → negado');
select is(pg_temp.status_of('boss'), 'active', 'colega com papel no mesmo nível → negado');

-- ---------------------------------------------------------------------------------------
-- Desbloquear: volta para a fila de espera, com auditoria
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('mg_mgr');
select lives_ok($$ select public.unblock_member('blocked@exemplo.org') $$,
  'desbloquear fora do escopo: a resposta é a mesma');
reset role;
select is(pg_temp.status_of('blocked'), 'blocked', 'desbloquear fora do escopo → negado');

set local role authenticated;
select pg_temp.login('abc_mgr');
select lives_ok($$ select public.unblock_member('member2@exemplo.org') $$,
  'desbloquear quem está ativo: a resposta é a mesma');
select lives_ok($$ select public.unblock_member('blocked@exemplo.org') $$,
  'gestor do ABC desbloqueia quem está bloqueado no ABC');
reset role;
select is(pg_temp.status_of('member2'), 'active', 'desbloquear quem está ativo não muda nada');
select is(pg_temp.status_of('blocked'), 'waitlisted',
  'desbloqueado volta para a espera (a liberação passa de novo pela fila)');
select is(pg_temp.audits('member_unblocked', 'blocked'), 1, 'desbloqueio gera member_unblocked');

-- ---------------------------------------------------------------------------------------
-- Raiz (revisão do #162): o manager da raiz alcança house_coordinator e tech_admin na raiz,
-- como em `can_revoke_role`; um manager da raiz nunca é bloqueável
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('sp_mgr');
select lives_ok($$ select public.block_member('hc.root@exemplo.org') $$,
  'gestor de SP x coordenador nacional de casa: a resposta é a mesma');
select lives_ok($$ select public.block_member('two.roles@exemplo.org') $$,
  'gestor de SP x alvo com um papel abaixo e outro em outro ramo: a resposta é a mesma');
reset role;
select is(pg_temp.status_of('hc_root'), 'active', 'coordenador de casa na raiz → negado para o gestor de SP');
select is(pg_temp.status_of('two_roles'), 'active', 'alvo com um papel abaixo e outro em outro ramo → negado');

set local role authenticated;
select pg_temp.login('root_mgr');
select lives_ok($$ select public.block_member('hc.root@exemplo.org') $$, 'gestor da raiz bloqueia o coordenador nacional de casa');
select lives_ok($$ select public.block_member('tech@exemplo.org') $$, 'gestor da raiz bloqueia o admin técnico');
select lives_ok($$ select public.block_member('two.roles@exemplo.org') $$, 'gestor da raiz bloqueia quem tem papéis em dois ramos');
select lives_ok($$ select public.block_member('root.mgr2@exemplo.org') $$, 'gestor da raiz x outro gestor da raiz: a resposta é a mesma');
reset role;
select is(pg_temp.status_of('hc_root'), 'blocked', 'coordenador de casa na raiz: bloqueado pelo gestor da raiz');
select is(pg_temp.status_of('tech'), 'blocked', 'admin técnico na raiz: bloqueado pelo gestor da raiz');
select is(pg_temp.status_of('two_roles'), 'blocked', 'papéis em dois ramos: bloqueado pelo gestor da raiz');
select is(pg_temp.status_of('root_mgr2'), 'active', 'gestor da raiz nunca é bloqueável');

-- Quem está bloqueado não desbloqueia ninguém (nem a si mesmo).
set local role authenticated;
select pg_temp.login('root_mgr');
select lives_ok($$ select public.block_member('sp.mgr@exemplo.org') $$, 'gestor da raiz bloqueia o gestor de SP');
select pg_temp.login('sp_mgr');
select throws_ok($$ select public.unblock_member('peer@exemplo.org') $$, '42501', null,
  'gestor bloqueado chamando unblock_member → 42501');
select throws_ok($$ select public.unblock_member('sp.mgr@exemplo.org') $$, '42501', null,
  'gestor bloqueado NÃO desbloqueia a si mesmo');
reset role;

-- Depois do desbloqueio (volta para a espera), a importação da lista NÃO libera sozinha: o
-- HMAC só fica guardado para quem foi à espera no primeiro login.
select is((select count(*)::int from public.access_waitlist_hmac where profile_id = pg_temp.person('blocked')), 0,
  'quem foi desbloqueado não tem HMAC guardado na espera');
set local role authenticated;
select pg_temp.login('root_mgr');
select lives_ok($$ select public.import_allowlist(array[encode(sha256('blocked@exemplo.org'::bytea), 'hex')], 'manual') $$,
  'gestor da raiz importa uma lista');
reset role;
select is(pg_temp.status_of('blocked'), 'waitlisted', 'a importação não libera quem foi desbloqueado (só a fila)');

-- ---------------------------------------------------------------------------------------
-- Limite: 30 tentativas por hora por quem chama, contando as que não mudam nada
-- ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.login('root_mgr2');
select lives_ok($$ do $d$ begin
  for i in 1..15 loop
    perform public.block_member('ninguem@exemplo.org');
    perform public.unblock_member('ninguem@exemplo.org');
  end loop;
end $d$ $$, '30 tentativas (bloquear e desbloquear, sem efeito) passam');
select throws_ok($$ select public.block_member('ninguem@exemplo.org') $$, '54000', 'too_many_attempts',
  'a 31ª tentativa de bloquear na hora é recusada');
select throws_ok($$ select public.unblock_member('ninguem@exemplo.org') $$, '54000', 'too_many_attempts',
  'o limite vale também para desbloquear');
reset role;
select is((select count(*)::int from app.member_block_attempts where actor_id = pg_temp.person('root_mgr2')), 30,
  'cada tentativa conta, mesmo sem efeito; as recusadas não');
select is(array(select column_name::text from information_schema.columns
                where table_schema = 'app' and table_name = 'member_block_attempts' order by ordinal_position),
  array['actor_id', 'attempted_at'], 'a tentativa guarda só quem e quando (nunca o e-mail)');
set local role authenticated;
select pg_temp.login('root_mgr2');
select throws_ok($$ select 1 from app.member_block_attempts $$, '42501', null,
  'ninguém lê as tentativas pela API');
reset role;

-- A busca por e-mail não é exposta.
set local role authenticated;
select pg_temp.login('sp_mgr');
select throws_ok($$ select app.account_by_email('member2@exemplo.org') $$, '42501', null,
  'ninguém consulta conta por e-mail pela API');
reset role;

select * from finish();
rollback;
