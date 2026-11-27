-- Chaves reais das casas (issue #193): casa-exemplo-1..4 passam a esparta, atenas, alexandria e
-- siracusa (os ids de config/instance.ts), sem apagar dado e sem recriar o banco.
--
-- A renomeação é uso único e roda aqui mesmo, num bloco anônimo: nenhuma função fica no banco (uma
-- função capaz de religar o log de auditoria não deve existir depois). Ela leva junto tudo que guarda
-- a chave da casa: `house_members.house_key`, `role_assignments.house_key`,
-- `questionnaire_results.house_key` (as três com FK para `houses`) e `audit_log.house_key` (sem FK).
-- O log de auditoria é só de inserção (trigger `audit_log_append_only`): como pede o aviso em
-- 20261119150000_access_allowlist.sql, esta migration o desliga de forma explícita e auditável, só
-- para trocar a chave da casa, e o religa antes de terminar (tudo na mesma transação: se algo falhar,
-- nada muda). Idempotente: sem a casa antiga, não faz nada; se a nova já existe, é reaproveitada.

do $$
declare
  renamed record;
begin
  alter table public.audit_log disable trigger audit_log_append_only;
  for renamed in
    select old_key, new_key
    from (values
      ('casa-exemplo-1', 'esparta'),
      ('casa-exemplo-2', 'atenas'),
      ('casa-exemplo-3', 'alexandria'),
      ('casa-exemplo-4', 'siracusa')
    ) as map (old_key, new_key)
    where exists (select 1 from public.houses as h where h.key = map.old_key)
  loop
    insert into public.houses (key, active)
    select renamed.new_key, h.active from public.houses as h where h.key = renamed.old_key
    on conflict (key) do nothing;

    update public.house_members set house_key = renamed.new_key where house_key = renamed.old_key;
    update public.role_assignments set house_key = renamed.new_key where house_key = renamed.old_key;
    update public.questionnaire_results set house_key = renamed.new_key where house_key = renamed.old_key;
    update public.audit_log set house_key = renamed.new_key where house_key = renamed.old_key;

    delete from public.houses where key = renamed.old_key;
  end loop;
  alter table public.audit_log enable trigger audit_log_append_only;
end;
$$;
