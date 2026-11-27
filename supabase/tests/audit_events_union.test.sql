-- Eventos da auditoria depois de juntar a entrega com a main (27/11): as duas redefiniam a mesma regra
-- (audit_log_event_check) com listas diferentes, e a que rodasse por último apagava os eventos da
-- outra. A regra final tem de aceitar os eventos dos dois lados.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(
  pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_log_event_check')) like '%evaluation_viewed%',
  'auditoria aceita o evento da entrega (evaluation_viewed)'
);
select ok(
  pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_log_event_check')) like '%questionnaire_result_viewed%',
  'auditoria aceita o evento da main (questionnaire_result_viewed)'
);
select ok(
  pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_log_event_check')) like '%house_analysis_resolved%',
  'auditoria aceita a análise de casa da main (house_analysis_resolved)'
);

select * from finish();
rollback;
