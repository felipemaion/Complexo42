-- Janela de transferência de casa (issue #302, ADR 0016, decisão do Felipe de 2026-11-28).
-- Troca a trava individual de 4 meses por um estado único, aberto ou fechado, SEM datas nem duração:
-- a coordenação nacional (gestor da raiz) liga e desliga quando quiser. Com a janela aberta, quem
-- quiser troca a própria casa (`accept_house`); fechada, não (C7605). A coordenação nacional troca a
-- casa de qualquer pessoa a qualquer momento (`coordination_set_house`, agora só a nacional).
-- Abrir, fechar e toda troca vão para o audit_log.

-- ---------------------------------------------------------------------------------------
-- 1. A trava individual sai
-- ---------------------------------------------------------------------------------------
drop trigger house_members_lock on public.house_members;
drop function app.tg_house_members_lock();
alter table public.house_members drop constraint house_members_locked_when_accepted;
alter table public.house_members drop column locked_until;
drop function app.house_lock_interval();

-- ---------------------------------------------------------------------------------------
-- 2. O estado da janela: uma linha só
-- ---------------------------------------------------------------------------------------
create table public.house_transfer_window (
  singleton boolean primary key default true check (singleton),
  is_open boolean not null default false,
  changed_at timestamptz,
  changed_by uuid references public.profiles (id) on delete set null
);

comment on table public.house_transfer_window is
  'Janela de transferência de casa (ADR 0016): uma linha, aberta ou fechada, sem datas. Só `set_house_transfer_window` a muda.';

insert into public.house_transfer_window (singleton, is_open) values (true, false);

create index house_transfer_window_changed_by_idx on public.house_transfer_window (changed_by);

alter table public.house_transfer_window enable row level security;

-- Quem é membro de verdade lê o estado (a tela mostra ou esconde "Trocar de casa"); ninguém escreve direto.
create policy house_transfer_window_select on public.house_transfer_window
  for select to authenticated
  using (app.is_onboarding_member());

-- Só `is_open`: quem mudou e quando ficam no audit_log (a nacional o lê).
revoke all on public.house_transfer_window from public, anon, authenticated;
grant select (is_open) on public.house_transfer_window to authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Auditoria: abrir e fechar a janela
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
  'questionnaire_result_viewed', 'house_changed',
  'house_window_opened', 'house_window_closed'
));

-- Os eventos da janela lê só a coordenação nacional (sem alvo, sem casa). O resto da leitura
-- vem de 20261127230000, sem mudança.
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
        or (event in ('house_window_opened', 'house_window_closed') and app.manages_root())
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

-- ---------------------------------------------------------------------------------------
-- 4. Abrir e fechar: só a coordenação nacional
-- ---------------------------------------------------------------------------------------
-- Devolve o estado depois da chamada. Repetir o mesmo estado não muda nada nem grava de novo.
create or replace function public.set_house_transfer_window(p_open boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  was_open boolean;
begin
  if caller is null or not app.manages_root() then
    raise exception 'só a coordenação nacional abre e fecha a janela' using errcode = 'insufficient_privilege';
  end if;
  if p_open is null then
    raise exception 'estado inválido' using errcode = 'invalid_parameter_value';
  end if;

  select w.is_open into was_open from public.house_transfer_window as w for update;
  if was_open is distinct from p_open then
    -- `where singleton`: o PostgREST roda com pg-safeupdate, que recusa UPDATE sem WHERE.
    update public.house_transfer_window set is_open = p_open, changed_at = now(), changed_by = caller where singleton;
    insert into public.audit_log (actor_id, event)
    values (caller, case when p_open then 'house_window_opened' else 'house_window_closed' end);
  end if;
  return p_open;
end;
$$;

comment on function public.set_house_transfer_window(boolean) is
  'A coordenação nacional abre ou fecha a janela de transferência de casa; grava house_window_opened/closed (ADR 0016).';

revoke execute on function public.set_house_transfer_window(boolean) from public, anon;
grant execute on function public.set_house_transfer_window(boolean) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. accept_house: trocar de casa só com a janela aberta
-- ---------------------------------------------------------------------------------------
-- Como em 20261127210000, sem a trava: com uma casa já aceita, a mesma devolve o mesmo vínculo;
-- outra só com a janela aberta (C7605). A primeira escolha é livre. A remoção pela coordenação
-- (C7602) continua impedindo a volta sozinha; trocas (`moved`) não contam como remoção.
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
  window_open boolean;
  new_id uuid;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.profiles as p where p.id = caller for update;
  if not app.is_onboarding_member() then
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

  select h.id, h.house_key, h.accepted_at
  into open_id, open_house, open_accepted
  from public.house_members as h
  where h.profile_id = caller and h.left_at is null
  for update;

  if open_accepted is not null then
    if open_house is not distinct from p_house_key then
      return open_id;
    end if;
    -- Outra casa: só com a janela de transferência aberta. FOR SHARE: um fechamento concorrente
    -- (`set_house_transfer_window` trava a linha com FOR UPDATE) espera esta troca terminar ou a precede.
    select w.is_open into window_open from public.house_transfer_window as w for share;
    if not coalesce(window_open, false) then
      raise exception 'a janela de transferência de casa está fechada' using errcode = 'C7605';
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

  begin
    if open_id is not null then
      update public.house_members set left_at = now(), moved = (open_accepted is not null) where id = open_id;
    end if;

    insert into public.house_members (profile_id, house_key, join_method, accepted_at, consent_version)
    values (caller, p_house_key, p_join_method, now(), consent_ver)
    returning id into new_id;
  exception when unique_violation then
    raise exception 'a casa mudou enquanto a troca era feita; tente de novo' using errcode = 'C7604';
  end;

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
  'Quem chama define a casa nacional `house_key`; trocar de casa só com a janela de transferência aberta (C7605). Guarda a forma e a versão do termo (ADR 0011, ADR 0016).';

-- ---------------------------------------------------------------------------------------
-- 6. coordination_set_house: só a coordenação nacional, a qualquer momento
-- ---------------------------------------------------------------------------------------
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
  new_id uuid;
begin
  if caller is null or not app.manages_root() or p_profile is null or p_profile = caller then
    raise exception 'só a coordenação nacional troca a casa de alguém' using errcode = 'insufficient_privilege';
  end if;

  -- O mesmo trinco de accept_house: as duas funções não correm uma contra a outra.
  perform 1 from public.profiles as p where p.id = p_profile for update;

  select h.id, h.house_key into open_id, open_house
  from public.house_members as h
  where h.profile_id = p_profile and h.left_at is null and h.accepted_at is not null
  for update;

  if open_id is null or not app.is_active_profile(p_profile) then
    raise exception 'sem alcance sobre esta pessoa' using errcode = 'insufficient_privilege';
  end if;

  if open_house is not distinct from p_house_key then
    return open_id;
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  update public.house_members set left_at = now(), moved = true where id = open_id;
  insert into public.house_members (profile_id, house_key, join_method, accepted_at)
  values (p_profile, p_house_key, 'self', now())
  returning id into new_id;

  insert into public.audit_log (actor_id, event, target_id, reason, house_key)
  values (caller, 'house_changed', p_profile, 'coordination', p_house_key);
  return new_id;
end;
$$;

comment on function public.coordination_set_house(uuid, text) is
  'A coordenação nacional troca a casa de uma pessoa a qualquer momento, com a janela aberta ou fechada; audita quem trocou (ADR 0016).';

-- ---------------------------------------------------------------------------------------
-- 7. Baixar meus dados: sem `locked_until`
-- ---------------------------------------------------------------------------------------
-- A cópia vigente (20261128010000) menos a trava; o resto idêntico. A troca (e quem a fez) segue
-- em `audit_events`.

create or replace function public.export_own_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_per_hour constant integer := 5;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('export_own_data:' || caller::text, 0));
  if (
    select count(*) from public.audit_log as a
    where a.actor_id = caller
      and a.event = 'data_exported'
      and a.created_at > now() - interval '1 hour'
  ) >= max_per_hour then
    raise exception 'limite de exportações por hora atingido'
      using errcode = 'program_limit_exceeded';
  end if;

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'data_exported', caller);

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'display_name_enc', p.display_name_enc,
        'municipality_code', p.municipality_code,
        'municipality_name', m.name,
        'state_code', p.state_code,
        'district_code', p.district_code,
        'district_name', d.name,
        'neighborhood_enc', p.neighborhood_enc,
        'status', p.status,
        'access_status', p.access_status,
        'consent_version', p.consent_version,
        'consent_at', p.consent_at,
        'profile_completed_at', p.profile_completed_at,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      from public.profiles as p
      left join public.municipalities as m on m.code = p.municipality_code
      left join public.districts as d on d.code = p.district_code
      where p.id = caller
    ),
    'contact', (
      select jsonb_build_object(
        'whatsapp_enc', c.whatsapp_enc,
        'social_links_enc', c.social_links_enc,
        'updated_at', c.updated_at
      )
      from public.profile_contacts as c
      where c.profile_id = caller
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_name', u.name,
        'unit_type', t.label,
        'member_role', um.member_role,
        'joined_at', um.joined_at,
        'left_at', um.left_at
      ) order by um.joined_at, um.id)
      from public.unit_members as um
      join public.units as u on u.id = um.unit_id
      join public.unit_types as t on t.id = u.type_id
      where um.profile_id = caller
    ), '[]'::jsonb),
    'house_memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'house_key', h.house_key,
        'join_method', h.join_method,
        'consent_version', h.consent_version,
        'joined_at', h.joined_at,
        'accepted_at', h.accepted_at,
        'left_at', h.left_at
      ) order by h.joined_at, h.id)
      from public.house_members as h
      where h.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'term_version', q.term_version,
        'consented_at', q.consented_at
      ) order by q.consented_at, q.term_version)
      from public.questionnaire_consents as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'consent_acceptances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version', c.version,
        'accepted_at', c.accepted_at
      ) order by c.accepted_at, c.version)
      from public.consent_acceptances as c
      where c.user_id = caller
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', r.role,
        'unit_name', u.name,
        'unit_type', t.label,
        'house_key', r.house_key,
        'granted_at', r.granted_at,
        'revoked_at', r.revoked_at
      ) order by r.granted_at, r.id)
      from public.role_assignments as r
      join public.units as u on u.id = r.unit_id
      join public.unit_types as t on t.id = u.type_id
      where r.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_result', (
      select jsonb_build_object(
        'house_key', r.house_key,
        'totem_enc', r.totem_enc,
        'totem_state', r.totem_state,
        'scores_enc', r.scores_enc,
        'answers_enc', r.answers_enc,
        'term_version', r.term_version,
        'source', r.source,
        'created_at', r.created_at
      )
      from public.questionnaire_results as r
      where r.profile_id = caller
    ),
    'house_analysis_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', q.status,
        'resolution', q.resolution,
        'term_version', q.term_version,
        'kind', q.kind,
        'tied_axes', q.tied_axes,
        'answers_enc', q.answers_enc,
        'created_at', q.created_at,
        'resolved_at', q.resolved_at
      ) order by q.created_at, q.id)
      from public.house_analysis_requests as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_access_grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_name', u.name,
        'unit_type', t.label,
        'granted_at', g.granted_at,
        'revoked_at', g.revoked_at
      ) order by g.granted_at, g.id)
      from public.questionnaire_data_grants as g
      join public.units as u on u.id = g.unit_id
      join public.unit_types as t on t.id = u.type_id
      where g.grantee_id = caller
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', a.event,
        'reason', a.reason,
        'term_version', a.term_version,
        'house_key', a.house_key,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.audit_log as a
      where a.target_id = caller
         or (a.actor_id = caller and a.event in ('house_accepted', 'questionnaire_consented', 'consent_accepted'))
    ), '[]'::jsonb),
    'contact_views', coalesce((
      select jsonb_agg(jsonb_build_object(
        'viewer_id', a.actor_id,
        'viewer_name_enc', p.display_name_enc,
        'kind', a.reason,
        'viewed_at', a.created_at
      ) order by a.created_at, a.id)
      from public.audit_log as a
      left join public.profiles as p on p.id = a.actor_id
      where a.target_id = caller
        and a.event = 'contact_viewed'
    ), '[]'::jsonb)
  );
end;
$$;
