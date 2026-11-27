-- Chaves reais das casas (issue #193): a migration de uso único que renomeou casa-exemplo-* para os
-- ids reais levou junto tudo que aponta para elas (vínculos, papéis de coordenador, resultados do
-- questionário e o log de auditoria) e não deixou função nenhuma no banco. Aqui se confere o
-- RESULTADO: nada aponta mais para as casas de exemplo, o log voltou a ser só de inserção e não
-- existe função capaz de religá-lo. O movimento dos dados foi ensaiado numa cópia do banco da demo.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- Nenhuma coluna que guarda a chave de uma casa aponta mais para casa-exemplo-* (o seed e a
-- migration já usam os ids reais).
select ok(not exists (select 1 from public.houses where key like 'casa-exemplo-%'), 'houses: sem casa-exemplo-*');
select ok(not exists (select 1 from public.house_members where house_key like 'casa-exemplo-%'), 'house_members: sem casa-exemplo-*');
select ok(not exists (select 1 from public.role_assignments where house_key like 'casa-exemplo-%'), 'role_assignments: sem casa-exemplo-*');
select ok(not exists (select 1 from public.questionnaire_results where house_key like 'casa-exemplo-%'), 'questionnaire_results: sem casa-exemplo-*');
select ok(not exists (select 1 from public.audit_log where house_key like 'casa-exemplo-%'), 'audit_log: sem casa-exemplo-*');
select set_eq($$ select key from public.houses $$, array['esparta', 'atenas', 'alexandria', 'siracusa'], 'as casas do banco são as quatro reais');

-- A renomeação foi uma migration de uso único: não sobra função que religue o log de auditoria.
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname like '%rename_house%'
  ),
  'nenhuma função de renomear casa ficou no banco'
);

-- O log de auditoria voltou a ser só de inserção: os dois triggers estão ligados e bloqueiam até o dono.
select is(
  (select count(*)::int from pg_trigger
   where tgrelid = 'public.audit_log'::regclass and tgname in ('audit_log_append_only', 'audit_log_no_truncate') and tgenabled = 'O'),
  2,
  'os dois triggers do log (UPDATE/DELETE e TRUNCATE) estão ligados'
);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'm1@exemplo.org');
insert into public.audit_log (actor_id, event, target_id, house_key, reason)
values ('00000000-0000-0000-0000-0000000000b1', 'house_accepted', '00000000-0000-0000-0000-0000000000b1', 'esparta', 'self');
select throws_ok($$ update public.audit_log set house_key = 'atenas' $$, '42501', 'audit_log só aceita inserções',
  'o log recusa UPDATE da chave da casa (só a migration, desligando o trigger, a trocou)');
select throws_ok($$ truncate public.audit_log $$, '42501', 'audit_log só aceita inserções', 'e recusa TRUNCATE');

select * from finish();
rollback;
