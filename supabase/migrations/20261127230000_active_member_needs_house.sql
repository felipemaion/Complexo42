-- Casa antes de tudo (ADR 0017, "ninguém vê nada"): o membro de verdade passa a exigir também a casa aceita (vínculo
-- aberto e aceito em `house_members`). Quem está liberado mas ainda não tem casa continua valendo como membro de ENTRADA
-- (`app.is_onboarding_member()`: ver as casas, termo do questionário, questionário, aceitar a casa) e não lê dados de
-- outras pessoas, unidades, coordenação, auditoria, delegação nem cortes até aceitar uma casa.
create or replace function app.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_onboarding_member()
    and exists (
      select 1 from public.profiles as p
      where p.id = (select auth.uid()) and p.profile_completed_at is not null
    )
    and exists (
      select 1 from public.consent_acceptances as c
      where c.user_id = (select auth.uid()) and c.version = app.current_consent_version()
    )
    and exists (
      select 1 from public.house_members as h
      where h.profile_id = (select auth.uid()) and h.left_at is null and h.accepted_at is not null
    );
$$;

comment on function app.is_active_member() is
  'Membro de verdade: liberado, com o termo vigente aceito, o perfil completo e a casa aceita. Sem isso, não tem escopo nem lê a estrutura (ADR 0008 §1, ADR 0017).';

-- A própria pessoa lê, ANTES de ter casa, o que ela mesma gerou na entrada: o resultado do questionário e os pedidos
-- (totem, casa sugerida) e os próprios eventos de casa e de termo. Isso fica com o predicado de entrada; todo o resto
-- (coordenação nacional, delegação, gestão, auditoria de outros) segue com `is_active_member`.
create or replace function app.can_read_questionnaire_data(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target is not null
    and (
      (target = (select auth.uid()) and app.is_onboarding_member())
      or (
        app.is_active_member()
        and (
          (app.manages_root() and app.is_active_profile(target))
          or app.has_questionnaire_delegation_over(target)
        )
      )
    );
$$;

create or replace function app.can_read_audit(event text, target uuid, actor uuid default null, house text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
      app.is_onboarding_member()
      and (
        (event in ('house_accepted', 'questionnaire_consented') and actor is not null and actor = (select auth.uid()))
        or (event = 'house_changed' and target = (select auth.uid()))
      )
    )
    or (
      app.is_active_member()
      and (
        (event = 'allowlist_imported' and app.manages_root())
        or (event in ('house_analysis_requested', 'house_analysis_resolved') and app.manages_root())
        or (
          event in ('house_analysis_requested', 'house_analysis_resolved')
          and target is not null
          and app.has_questionnaire_delegation_over(target)
        )
        or (event in ('questionnaire_access_granted', 'questionnaire_access_revoked', 'questionnaire_result_viewed') and app.manages_root())
        or (
          target is not null
          and event not in ('house_analysis_requested', 'house_analysis_resolved',
                            'questionnaire_access_granted', 'questionnaire_access_revoked',
                            'questionnaire_result_viewed')
          and app.manages_member(target)
        )
        or (
          event = 'house_accepted'
          and target is not null
          and house is not null
          and house = app.open_house_of(target)
          and app.is_house_coordinator_of((select auth.uid()), target)
        )
      )
    );
$$;
