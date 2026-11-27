-- Chaves reais das casas (issue #193): casa-exemplo-1..4 passam a esparta, atenas, alexandria e
-- siracusa (os ids de config/instance.ts), sem apagar dado e sem recriar o banco.
--
-- `app.rename_house_key(antiga, nova)` leva junto tudo que guarda a chave da casa:
-- `house_members.house_key`, `role_assignments.house_key`, `questionnaire_results.house_key` (as
-- três com FK para `houses`) e `audit_log.house_key` (sem FK). O log de auditoria é só de inserção
-- (trigger `audit_log_append_only`): como pede o aviso em 20261119150000_access_allowlist.sql, esta
-- migration o religa de forma explícita e auditável, só para trocar a chave da casa, e o religa em
-- seguida. Idempotente: sem a casa antiga, não faz nada; se a nova já existe, é reaproveitada.

create or replace function app.rename_house_key(old_key text, new_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old_key = new_key or not exists (select 1 from public.houses as h where h.key = old_key) then
    return;
  end if;
  insert into public.houses (key, active)
  select new_key, h.active from public.houses as h where h.key = old_key
  on conflict (key) do nothing;

  update public.house_members set house_key = new_key where house_key = old_key;
  update public.role_assignments set house_key = new_key where house_key = old_key;
  update public.questionnaire_results set house_key = new_key where house_key = old_key;

  -- O log só aceita inserções: troca só a chave da casa, com o trigger desligado só aqui dentro.
  alter table public.audit_log disable trigger audit_log_append_only;
  update public.audit_log set house_key = new_key where house_key = old_key;
  alter table public.audit_log enable trigger audit_log_append_only;

  delete from public.houses where key = old_key;
end;
$$;

comment on function app.rename_house_key(text, text) is
  'Renomeia a chave de uma casa levando junto vínculos, papéis, resultados do questionário e o log de auditoria (religado de forma explícita). Idempotente. Sem grant: só migrations e o dono do banco.';

revoke execute on function app.rename_house_key(text, text) from public, anon, authenticated;

select app.rename_house_key('casa-exemplo-1', 'esparta');
select app.rename_house_key('casa-exemplo-2', 'atenas');
select app.rename_house_key('casa-exemplo-3', 'alexandria');
select app.rename_house_key('casa-exemplo-4', 'siracusa');
