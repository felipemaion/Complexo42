-- supabase/migrations/20261128000400_badges.sql
-- ADR 0006 §8, ADR 0007 §3 e Issues #34, #35, #37 (Medalhas/Badges)

-- ============================================================================
-- 1. Tabelas e Estrutura de Dados
-- ============================================================================

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  scope_unit_id uuid not null references public.units(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  name text not null check (length(name) between 2 and 60),
  description text not null default '' check (length(description) <= 300),
  icon text not null default 'estrela' check (icon in ('estrela','trofeu','fogo','livro','megafone','camera','coracao','escudo')),
  rule_type text not null default 'manual' check (rule_type in ('manual','event','worked_with','milestone','attendance','mission_completed','points_threshold')),
  rule_params jsonb not null default '{}',
  named_after_profile_id uuid references auth.users(id) on delete set null,
  story text check (story is null or length(story) <= 500),
  created_at timestamptz not null default now()
);

create table public.profile_badges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete restrict,
  awarded_at timestamptz not null default now(),
  awarded_by uuid references auth.users(id) on delete set null,
  submission_id uuid references public.step_submissions(id) on delete set null,
  reason text not null check (length(reason) between 3 and 300),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) between 3 and 300)
);

-- ADR 0007 §3: Índice único parcial para garantir que cada perfil só tenha uma concessão ativa por medalha
create unique index idx_profile_badges_active
  on public.profile_badges (profile_id, badge_id)
  where revoked_at is null;

-- Trigger: quando named_after_profile_id virar null (exclusão de conta), apagar story (MODELO_DADOS)
create or replace function public.clear_badge_story_on_profile_null()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.named_after_profile_id is null and old.named_after_profile_id is not null then
    new.story := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_badge_story_on_profile_null() from public, anon, authenticated;

create trigger trg_clear_badge_story
  before update of named_after_profile_id on public.badges
  for each row
  execute function public.clear_badge_story_on_profile_null();

-- ============================================================================
-- 2. Permissões e RLS (Row Level Security)
-- ============================================================================

alter table public.badges enable row level security;
alter table public.profile_badges enable row level security;

revoke all on table public.badges from anon, authenticated;
revoke all on table public.profile_badges from anon, authenticated;

grant select on table public.badges to authenticated;
grant select on table public.profile_badges to authenticated;

-- Leitura de badges: membros ativos (ADR 0007 §3)
create policy badges_select_active_member on public.badges
  for select to authenticated
  using (app.is_active_member());

-- Leitura de profile_badges: dono ou quem tem permissão para ver o perfil (§3 e §4)
create policy profile_badges_select on public.profile_badges
  for select to authenticated
  using (
    profile_id = auth.uid()
    or app.can_view_profile(profile_id)
  );

-- ============================================================================
-- 3. Funções da API Pública (Security Definer)
-- ============================================================================

-- Criação de medalha manual (ADR 0006 §8, ADR 0007 §3, Issue #34)
create or replace function public.create_badge(
  p_scope_unit uuid,
  p_name text,
  p_description text default '',
  p_icon text default 'estrela'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_path extensions.ltree;
  v_badge_id uuid;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem criar medalhas' using errcode = '42501';
  end if;

  select path into v_unit_path
  from public.units
  where id = p_scope_unit;

  if v_unit_path is null or not app.has_scope_over(v_unit_path, array['manager', 'monitor']) then
    raise exception 'Sem permissão de escopo para criar medalha nesta unidade' using errcode = '42501';
  end if;

  insert into public.badges (
    scope_unit_id,
    created_by,
    name,
    description,
    icon,
    rule_type
  ) values (
    p_scope_unit,
    auth.uid(),
    trim(p_name),
    coalesce(trim(p_description), ''),
    p_icon,
    'manual'
  )
  returning id into v_badge_id;

  return v_badge_id;
end;
$$;

-- Opções de medalhas manuais disponíveis para concessão no escopo do usuário (Issue #35)
create or replace function public.badge_options()
returns table (
  id uuid,
  name text,
  description text,
  icon text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_member() then
    return;
  end if;

  return query
  select
    b.id,
    b.name,
    b.description,
    b.icon
  from public.badges b
  join public.units u on u.id = b.scope_unit_id
  where b.rule_type = 'manual'
    and app.has_scope_over(u.path, array['manager', 'monitor'])
  order by b.name;
end;
$$;

-- Concessão manual de medalha (ADR 0007 §3, Issues #35 e #37)
create or replace function public.grant_badge(
  p_badge uuid,
  p_profile uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_unit_id uuid;
  v_unit_path extensions.ltree;
  v_reason text;
  v_award_id uuid;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem conceder medalhas' using errcode = '42501';
  end if;

  -- Regra: ninguém concede medalha a si mesmo (ADR 0007 §3)
  if p_profile = auth.uid() then
    raise exception 'Não é permitido conceder medalha a si mesmo' using errcode = '42501';
  end if;

  v_reason := trim(p_reason);
  if length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Motivo da concessão deve ter entre 3 e 300 caracteres' using errcode = '22023';
  end if;

  if not app.is_active_profile(p_profile) or not app.can_view_profile(p_profile) then
    raise exception 'Perfil alvo inválido ou sem visibilidade' using errcode = '42501';
  end if;

  select scope_unit_id into v_scope_unit_id
  from public.badges
  where id = p_badge;

  if v_scope_unit_id is null then
    raise exception 'Medalha não encontrada' using errcode = '42501';
  end if;

  select path into v_unit_path
  from public.units
  where id = v_scope_unit_id;

  if v_unit_path is null or not app.has_scope_over(v_unit_path, array['manager', 'monitor']) then
    raise exception 'Sem permissão de escopo para conceder esta medalha' using errcode = '42501';
  end if;

  insert into public.profile_badges (
    profile_id,
    badge_id,
    awarded_by,
    reason
  ) values (
    p_profile,
    p_badge,
    auth.uid(),
    v_reason
  )
  returning id into v_award_id;

  insert into public.audit_log (
    actor_id,
    event,
    target_id
  ) values (
    auth.uid(),
    'badge_granted',
    v_award_id
  );

  return v_award_id;
end;
$$;

-- Revogação de medalha (ADR 0006 §8, Issue #37)
create or replace function public.revoke_badge(
  p_award uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badge_id uuid;
  v_scope_unit_id uuid;
  v_unit_path extensions.ltree;
  v_revoked_at timestamptz;
  v_reason text;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem revogar medalhas' using errcode = '42501';
  end if;

  v_reason := trim(p_reason);
  if length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Motivo da revogação deve ter entre 3 e 300 caracteres' using errcode = '22023';
  end if;

  select pb.badge_id, pb.revoked_at, b.scope_unit_id
  into v_badge_id, v_revoked_at, v_scope_unit_id
  from public.profile_badges pb
  join public.badges b on b.id = pb.badge_id
  where pb.id = p_award;

  if v_badge_id is null then
    raise exception 'Concessão de medalha não encontrada' using errcode = '42501';
  end if;

  if v_revoked_at is not null then
    raise exception 'Medalha já se encontra revogada' using errcode = 'C7612';
  end if;

  select path into v_unit_path
  from public.units
  where id = v_scope_unit_id;

  if v_unit_path is null or not app.has_scope_over(v_unit_path, array['manager', 'monitor']) then
    raise exception 'Sem permissão de escopo para revogar esta medalha' using errcode = '42501';
  end if;

  update public.profile_badges
  set
    revoked_at = now(),
    revoked_by = auth.uid(),
    revoked_reason = v_reason
  where id = p_award;

  insert into public.audit_log (
    actor_id,
    event,
    target_id
  ) values (
    auth.uid(),
    'badge_revoked',
    p_award
  );
end;
$$;

-- Listagem de medalhas do perfil para exibição de coleção (ADR 0007 §3, sem ranking)
create or replace function public.profile_badge_list(p_profile uuid)
returns table (
  award_id uuid,
  name text,
  description text,
  icon text,
  reason text,
  awarded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (p_profile = auth.uid() or app.can_view_profile(p_profile)) then
    return;
  end if;

  return query
  select
    pb.id as award_id,
    b.name,
    b.description,
    b.icon,
    pb.reason,
    pb.awarded_at
  from public.profile_badges pb
  join public.badges b on b.id = pb.badge_id
  where pb.profile_id = p_profile
    and pb.revoked_at is null
  order by pb.awarded_at desc;
end;
$$;

-- Permissões de execução das funções da API pública
revoke all on function public.create_badge(uuid, text, text, text) from public, anon;
grant execute on function public.create_badge(uuid, text, text, text) to authenticated;

revoke all on function public.badge_options() from public, anon;
grant execute on function public.badge_options() to authenticated;

revoke all on function public.grant_badge(uuid, uuid, text) from public, anon;
grant execute on function public.grant_badge(uuid, uuid, text) to authenticated;

revoke all on function public.revoke_badge(uuid, text) from public, anon;
grant execute on function public.revoke_badge(uuid, text) to authenticated;

revoke all on function public.profile_badge_list(uuid) from public, anon;
grant execute on function public.profile_badge_list(uuid) to authenticated;
