-- Aceite do termo de consentimento (issue #11, docs/TERMO_CONSENTIMENTO.md).
--
-- 1. `public.accept_consent(p_version)`: única via que muda `profiles.consent_version` (o
--    cadastro `save_own_profile` cria o perfil com 'none' e nunca a altera). Só a própria
--    pessoa; o `consent_at` é gravado pelo trigger quando a versão muda. A versão do termo vem
--    do servidor (config/consent.ts), nunca do navegador. Aceitar a versão que já vale não
--    regrava nem audita de novo.
-- 2. Auditoria: o evento `consent_accepted` (ator = a pessoa, `term_version` = a versão),
--    como o do questionário. Sem dado pessoal.
--
-- A função devolve o resultado, em vez de erro, para o que é esperado: 'accepted' (gravou ou já
-- estava na versão) ou 'no_profile' (o perfil ainda não existe; o servidor guarda o aceite
-- pendente e repete depois de salvar o perfil).

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted'
));

alter table public.audit_log drop constraint audit_log_term_version_by_event;
alter table public.audit_log add constraint audit_log_term_version_by_event check (
  case
    when event in ('questionnaire_consented', 'consent_accepted') then term_version is not null
    when event = 'house_accepted' then (term_version is not null) = (reason = 'questionnaire')
    else term_version is null
  end
);

create function public.accept_consent(p_version text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  stored text;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_edit_profile(caller) then
    raise exception 'sem permissão para aceitar o termo' using errcode = 'insufficient_privilege';
  end if;
  -- 'none' é "sem aceite": nunca é uma versão de termo.
  if p_version is null or p_version = 'none' or p_version !~ '^[A-Za-z0-9._-]{1,32}$' then
    raise exception 'versão do termo inválida' using errcode = 'invalid_parameter_value';
  end if;

  -- Trava o perfil: dois aceites ao mesmo tempo não gravam dois eventos.
  select p.consent_version into stored
  from public.profiles as p
  where p.id = caller
  for update;
  if not found then
    return 'no_profile';
  end if;
  if stored = p_version then
    return 'accepted';
  end if;

  update public.profiles set consent_version = p_version where id = caller;
  insert into public.audit_log (actor_id, event, term_version)
  values (caller, 'consent_accepted', p_version);
  return 'accepted';
end;
$$;

comment on function public.accept_consent(text) is
  'Aceite do termo (#11): grava profiles.consent_version (e consent_at, pelo trigger) de quem chama, com auditoria. Sem perfil devolve no_profile.';

revoke execute on function public.accept_consent(text) from public, anon;
grant execute on function public.accept_consent(text) to authenticated;
