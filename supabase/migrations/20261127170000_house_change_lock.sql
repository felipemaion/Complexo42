-- Trava de 4 meses para a pessoa trocar de casa; a coordenação troca a qualquer momento.
--
-- Regras (decisão da coordenação nacional, 2026-11-27):
-- 1. Definida a casa (aceita, escolhida direto ou decidida pela coordenação), a pessoa só a troca
--    por conta própria 4 meses depois do aceite do termo do questionário (sem termo aceito, 4 meses
--    depois do aceite da casa). A trava vive em `house_members.locked_until`, preenchida no banco.
-- 2. Quem tem alcance sobre a pessoa (o mesmo de `can_manage_house_member`, ou o das telas de
--    resultado: `can_read_questionnaire_data`) troca a casa a qualquer momento, por
--    `coordination_set_house`. A troca da coordenação mantém a trava da pessoa.
-- 3. Toda troca (da pessoa ou da coordenação) grava `house_changed` no audit_log, com quem trocou.
--    Depois de uma troca da própria pessoa a trava recomeça (4 meses a partir da troca).
-- Nada disso depende da interface: a pessoa não escreve em house_members; só `accept_house`
-- (security definer, relógio do servidor) troca a casa dela.

-- ---------------------------------------------------------------------------------------
-- 1. Coluna e preenchimento
-- ---------------------------------------------------------------------------------------
create or replace function app.house_lock_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '4 months' $$;

revoke execute on function app.house_lock_interval() from public, anon;
grant execute on function app.house_lock_interval() to authenticated;

alter table public.house_members
  add column locked_until timestamptz,
  add column moved boolean not null default false;

comment on column public.house_members.locked_until is
  'Até quando a pessoa não troca esta casa por conta própria (4 meses do aceite do termo do questionário; sem termo, do aceite da casa). A coordenação ignora a trava.';
comment on column public.house_members.moved is
  'Verdadeiro quando o vínculo foi encerrado por uma troca de casa (da pessoa ou da coordenação), e não por remoção.';

-- Vínculos já aceitos: 4 meses a partir do aceite do termo do questionário (ou do aceite da casa).
update public.house_members as h
set locked_until = coalesce(
  (select min(c.consented_at) from public.questionnaire_consents as c where c.profile_id = h.profile_id),
  h.accepted_at
) + app.house_lock_interval()
where h.accepted_at is not null;

-- Vínculo aceito sem trava explícita (entrada pela primeira vez) recebe a trava padrão.
create or replace function app.tg_house_members_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepted_at is not null and new.locked_until is null then
    new.locked_until := coalesce(
      (select min(c.consented_at) from public.questionnaire_consents as c where c.profile_id = new.profile_id),
      new.accepted_at
    ) + app.house_lock_interval();
  end if;
  return new;
end;
$$;

create trigger house_members_lock
  before insert on public.house_members
  for each row execute function app.tg_house_members_lock();

revoke execute on function app.tg_house_members_lock() from public, anon, authenticated;

alter table public.house_members
  add constraint house_members_locked_when_accepted check (accepted_at is null or locked_until is not null);

-- ---------------------------------------------------------------------------------------
-- 2. Auditoria: house_changed
-- ---------------------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked',
  'house_analysis_requested', 'house_analysis_resolved',
  'questionnaire_access_granted', 'questionnaire_access_revoked',
  'questionnaire_result_viewed', 'house_changed'
));

alter table public.audit_log
  drop constraint audit_log_reason_by_event,
  add constraint audit_log_reason_by_event check (
    case
      when event in ('access_granted', 'access_blocked') then coalesce(reason in ('manual', 'import'), false)
      when event = 'house_accepted' then coalesce(reason in ('self', 'questionnaire'), false)
      when event = 'house_changed' then coalesce(reason in ('self', 'coordination'), false)
      when event = 'contact_viewed' then coalesce(reason in ('whatsapp', 'social', 'email'), false)
      when event = 'member_blocked' then reason is null or reason in ('impersonation', 'conduct', 'other')
      else reason is null
    end
  );

alter table public.audit_log
  drop constraint audit_log_house_key_by_event,
  add constraint audit_log_house_key_by_event check (
    case
      when event = 'house_accepted' then house_key is not null and target_id = actor_id
      when event = 'house_changed' then house_key is not null and target_id is not null and actor_id is not null
      else house_key is null
    end
  ) not valid;

-- A pessoa lê as trocas da própria casa (feitas por ela ou pela coordenação); quem tem alcance
-- sobre ela lê pelo ramo geral (`manages_member`). Resto como em 20261127140000.
create or replace function app.can_read_audit(event text, target uuid, actor uuid default null, house text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
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
        event in ('house_accepted', 'questionnaire_consented')
        and actor is not null
        and actor = (select auth.uid())
      )
      or (event = 'house_changed' and target = (select auth.uid()))
      or (
        event = 'house_accepted'
        and target is not null
        and house is not null
        and house = app.open_house_of(target)
        and app.is_house_coordinator_of((select auth.uid()), target)
      )
    );
$$;

-- ---------------------------------------------------------------------------------------
-- 3. accept_house: a pessoa define a casa; trocar, só passada a trava
-- ---------------------------------------------------------------------------------------
-- Como em 20261119230000, com a troca:
-- - com uma casa já aceita: a mesma devolve o mesmo vínculo; outra só passada a trava
--   (`locked_until`, hora do servidor), senão C7603; passada, encerra o vínculo (`moved`),
--   abre o novo com trava nova de 4 meses e grava `house_changed` (motivo `self`);
-- - a remoção pela coordenação (C7602) continua impedindo a volta sozinha; trocas (`moved`)
--   não contam como remoção.
create or replace function public.accept_house(p_house_key text, p_join_method text, p_term_version text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  consent_ver text;
  open_id uuid;
  open_house text;
  open_accepted timestamptz;
  open_locked timestamptz;
  new_id uuid;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.profiles as p where p.id = caller for update;
  if not app.is_active_member() then
    raise exception 'só quem está ativo escolhe a casa' using errcode = 'insufficient_privilege';
  end if;

  if p_join_method is null or p_join_method not in ('self', 'questionnaire') then
    raise exception 'forma de entrada inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_join_method = 'questionnaire' then
    if not exists (
      select 1 from public.questionnaire_consents as c
      where c.profile_id = caller and c.term_version = p_term_version
    ) then
      raise exception 'o questionário exige o termo desta versão aceito'
        using errcode = 'invalid_parameter_value';
    end if;
    consent_ver := p_term_version;
  end if;

  select h.id, h.house_key, h.accepted_at, h.locked_until
  into open_id, open_house, open_accepted, open_locked
  from public.house_members as h
  where h.profile_id = caller and h.left_at is null;

  if open_accepted is not null then
    if open_house is not distinct from p_house_key then
      return open_id;
    end if;
    -- Outra casa: só passada a trava de 4 meses (relógio do servidor).
    if now() < open_locked then
      raise exception 'a casa só pode ser trocada pela própria pessoa depois de %',
        to_char(open_locked at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
        using errcode = 'C7603', hint = to_char(open_locked at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
  end if;

  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.house_members as h
    where h.profile_id = caller
      and h.left_at is not null
      and not h.moved
      and h.ended_by is distinct from caller
  ) then
    raise exception 'a coordenação encerrou a sua casa; a volta é com ela' using errcode = 'C7602';
  end if;

  if open_id is not null then
    update public.house_members set left_at = now(), moved = (open_accepted is not null) where id = open_id;
  end if;

  insert into public.house_members (profile_id, house_key, join_method, accepted_at, consent_version, locked_until)
  values (
    caller, p_house_key, p_join_method, now(), consent_ver,
    case when open_accepted is not null then now() + app.house_lock_interval() end
  )
  returning id into new_id;

  if open_accepted is not null then
    insert into public.audit_log (actor_id, event, target_id, reason, house_key)
    values (caller, 'house_changed', caller, 'self', p_house_key);
  else
    insert into public.audit_log (actor_id, event, target_id, reason, term_version, house_key)
    values (caller, 'house_accepted', caller, p_join_method, consent_ver, p_house_key);
  end if;
  return new_id;
end;
$$;

comment on function public.accept_house(text, text, text) is
  'Quem chama define a casa nacional `house_key`; trocar de casa só depois da trava de 4 meses (C7603). Guarda a forma e a versão do termo (ADR 0011, ADR 0015).';

-- ---------------------------------------------------------------------------------------
-- 4. coordination_set_house: a coordenação troca a casa a qualquer momento
-- ---------------------------------------------------------------------------------------
-- Quem chama precisa ter alcance sobre a pessoa (`can_manage_house_member` na casa atual, ou
-- `can_read_questionnaire_data`, o das telas de resultado) e não ser a própria pessoa. A pessoa
-- precisa ter casa aceita. A trava dela é mantida. Devolve o id do vínculo novo (ou o atual, se
-- a casa já é essa). Registra `house_changed` (motivo `coordination`).
create or replace function public.coordination_set_house(p_profile uuid, p_house_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  open_id uuid;
  open_house text;
  open_locked timestamptz;
  new_id uuid;
begin
  if caller is null or not app.is_active_member() or p_profile is null or p_profile = caller then
    raise exception 'sem alcance sobre esta pessoa' using errcode = 'insufficient_privilege';
  end if;

  select h.id, h.house_key, h.locked_until into open_id, open_house, open_locked
  from public.house_members as h
  where h.profile_id = p_profile and h.left_at is null and h.accepted_at is not null
  for update;

  if open_id is null
     or not (app.can_manage_house_member(p_profile, open_house) or app.can_read_questionnaire_data(p_profile)) then
    raise exception 'sem alcance sobre esta pessoa' using errcode = 'insufficient_privilege';
  end if;

  if open_house is not distinct from p_house_key then
    return open_id;
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  update public.house_members set left_at = now(), moved = true where id = open_id;
  insert into public.house_members (profile_id, house_key, join_method, accepted_at, locked_until)
  values (p_profile, p_house_key, 'self', now(), open_locked)
  returning id into new_id;

  insert into public.audit_log (actor_id, event, target_id, reason, house_key)
  values (caller, 'house_changed', p_profile, 'coordination', p_house_key);
  return new_id;
end;
$$;

comment on function public.coordination_set_house(uuid, text) is
  'A coordenação com alcance sobre a pessoa troca a casa dela a qualquer momento; mantém a trava; audita quem trocou (ADR 0015).';

revoke execute on function public.coordination_set_house(uuid, text) from public, anon;
grant execute on function public.coordination_set_house(uuid, text) to authenticated;
