-- Eventos de auditoria da escolha da casa (issue #76, revisão do #124, L7).
--
-- Fica numa migration posterior a 20261119190000 (#20, `data_exported`) de propósito: a
-- constraint de eventos é redefinida inteira em cada migration que acrescenta evento, e a
-- última a rodar vence. A lista abaixo é a COMPLETA, com todos os eventos que já existiam
-- (inclusive `data_exported`, da #20) mais os dois desta issue. Quem acrescentar evento
-- depois precisa partir desta lista.
--
-- `house_accepted`: actor = a pessoa, target = a unidade da casa, reason = a forma de entrada
-- (self ou questionnaire), term_version = a versão do termo (só no questionário).
-- `questionnaire_consented`: actor = a pessoa, term_version = a versão. Nunca respostas.

alter table public.audit_log
  add column term_version text
    constraint audit_log_term_version_format check (term_version ~ '^[A-Za-z0-9._-]{1,32}$');

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented'
));

-- `reason`: nas decisões de acesso (manual, import) e em `house_accepted` (a forma de entrada).
alter table public.audit_log
  drop constraint audit_log_reason_check,
  drop constraint audit_log_reason_only_for_access,
  add constraint audit_log_reason_by_event check (
    case
      when event in ('access_granted', 'access_blocked') then reason in ('manual', 'import')
      when event = 'house_accepted' then reason in ('self', 'questionnaire')
      else reason is null
    end
  ),
  add constraint audit_log_term_version_by_event check (
    case
      when event = 'questionnaire_consented' then term_version is not null
      when event = 'house_accepted' then (term_version is not null) = (reason = 'questionnaire')
      else term_version is null
    end
  );
