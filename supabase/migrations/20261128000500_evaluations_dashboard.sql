-- supabase/migrations/20261128000500_evaluations_dashboard.sql
-- ADR 0007 §4, ADR 0008 §3 e Issue #49 (Avaliação Reservada e Painel da Coordenação)

-- ============================================================================
-- 1. Tabelas e Estrutura de Dados
-- ============================================================================

-- Tabela de avaliações reservadas (ADR 0007 §4, ADR 0008 §3)
create table public.member_evaluations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  evaluator_id uuid references auth.users(id) on delete set null,
  unit_id uuid not null references public.units(id) on delete restrict,
  axis text not null check (axis in ('team', 'house')),
  mission_id uuid references public.missions(id) on delete set null,
  cycle_ends_on date not null,
  grade_enc text not null check (app.is_encrypted_value(grade_enc, 128)),
  note_enc text check (note_enc is null or app.is_encrypted_value(note_enc, 3000)),
  created_at timestamptz not null default now()
);

-- Trigger de imutabilidade: bloqueia UPDATE e DELETE, permitindo apenas a anulação de evaluator_id via cascata
create or replace function public.prevent_member_evaluations_modification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Única exclusão aceita: a cascata da exclusão da conta da pessoa avaliada (a conta já
    -- saiu de auth.users). Sem isso, a avaliação travaria o direito de excluir a conta (LGPD).
    if not exists (select 1 from auth.users as u where u.id = old.profile_id) then
      return old;
    end if;
    raise exception 'Exclusão de avaliação não é permitida' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.evaluator_id is not null
       and new.evaluator_id is null
       and new.id = old.id
       and new.profile_id = old.profile_id
       and new.unit_id = old.unit_id
       and new.axis = old.axis
       and new.mission_id is not distinct from old.mission_id
       and new.cycle_ends_on = old.cycle_ends_on
       and new.grade_enc = old.grade_enc
       and new.note_enc is not distinct from old.note_enc
       and new.created_at = old.created_at then
      return new;
    end if;

    raise exception 'Alteração de avaliação não é permitida' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_member_evaluations_modification() from public, anon, authenticated;

create trigger trg_protect_member_evaluations
  before update or delete on public.member_evaluations
  for each row
  execute function public.prevent_member_evaluations_modification();

-- ============================================================================
-- 2. Permissões e RLS (Row Level Security)
-- ============================================================================

alter table public.member_evaluations enable row level security;

revoke all on table public.member_evaluations from anon, authenticated;
grant select on table public.member_evaluations to authenticated;

-- Leitura: avaliador visualiza apenas as avaliações que concedeu (ADR 0007 §4)
create policy member_evaluations_select on public.member_evaluations
  for select to authenticated
  using (evaluator_id = auth.uid());

-- ============================================================================
-- 3. Funções da API Pública (Security Definer)
-- ============================================================================

-- Submissão de avaliação reservada (ADR 0007 §4, ADR 0008 §3)
create or replace function public.submit_evaluation(
  p_profile uuid,
  p_axis text,
  p_grade_enc text,
  p_note_enc text,
  p_cycle_ends_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id uuid;
  v_is_team boolean;
  v_is_lead boolean;
  v_evaluation_id uuid;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem registrar avaliações' using errcode = '42501';
  end if;

  if p_profile = auth.uid() then
    raise exception 'Não é permitido avaliar a si mesmo' using errcode = '42501';
  end if;

  select um.unit_id
    into v_unit_id
  from public.unit_members um
  where um.profile_id = p_profile
    and um.left_at is null;

  if v_unit_id is null then
    raise exception 'Perfil avaliado não possui vínculo ativo em uma unidade' using errcode = '42501';
  end if;

  if p_axis = 'team' then
    select ut.is_team
      into v_is_team
    from public.units u
    join public.unit_types ut on ut.id = u.type_id
    where u.id = v_unit_id;

    if not coalesce(v_is_team, false) then
      raise exception 'A unidade do avaliado não é uma equipe' using errcode = '42501';
    end if;

    select exists (
      select 1
      from public.unit_members um
      where um.unit_id = v_unit_id
        and um.profile_id = auth.uid()
        and um.member_role = 'lead'
        and um.left_at is null
    ) into v_is_lead;

    if not (v_is_lead or app.can_manage_unit(v_unit_id)) then
      raise exception 'Sem permissão para avaliar membro nesta equipe' using errcode = '42501';
    end if;
  elsif p_axis = 'house' then
    if not app.is_house_coordinator_of(auth.uid(), p_profile) then
      raise exception 'Apenas coordenador da casa pode avaliar este perfil' using errcode = '42501';
    end if;
  else
    raise exception 'Eixo de avaliação inválido' using errcode = '42501';
  end if;

  insert into public.member_evaluations (
    profile_id,
    evaluator_id,
    unit_id,
    axis,
    cycle_ends_on,
    grade_enc,
    note_enc
  ) values (
    p_profile,
    auth.uid(),
    v_unit_id,
    p_axis,
    p_cycle_ends_on,
    p_grade_enc,
    p_note_enc
  )
  returning id into v_evaluation_id;

  return v_evaluation_id;
end;
$$;

-- Consulta de avaliações concedidas pelo usuário autenticado (ADR 0007 §4)
create or replace function public.my_given_evaluations()
returns table (
  evaluation_id uuid,
  profile_id uuid,
  axis text,
  grade_enc text,
  note_enc text,
  cycle_ends_on date,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    me.id as evaluation_id,
    me.profile_id,
    me.axis,
    me.grade_enc,
    me.note_enc,
    me.cycle_ends_on,
    me.created_at
  from public.member_evaluations me
  where me.evaluator_id = auth.uid()
  order by me.created_at desc;
$$;

-- Painel da coordenação de equipes (Issue #49)
create or replace function public.team_dashboard()
returns table (
  team_id uuid,
  team_name text,
  member_count integer,
  active_runs integer,
  completed_runs integer,
  team_points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id as team_id,
    u.name as team_name,
    (
      select count(*)::integer
      from public.unit_members um
      where um.unit_id = u.id
        and um.left_at is null
    ) as member_count,
    (
      select count(*)::integer
      from public.mission_runs mr
      where mr.unit_id = u.id
        and mr.status = 'active'
    ) as active_runs,
    (
      select count(*)::integer
      from public.mission_runs mr
      where mr.unit_id = u.id
        and mr.status = 'completed'
    ) as completed_runs,
    (
      select coalesce(sum(pl.points), 0)::integer
      from public.points_ledger pl
      where pl.unit_id = u.id
        and pl.profile_id is null
    ) as team_points
  from public.units u
  join public.unit_types ut on ut.id = u.type_id
  where app.is_active_member()
    and ut.is_team = true
    and u.status = 'active'
    and app.can_manage_unit(u.id)
  order by team_points desc, u.name asc;
$$;

-- ============================================================================
-- 4. Permissões de Execução das Funções
-- ============================================================================

revoke all on function public.submit_evaluation(uuid, text, text, text, date) from public, anon;
grant execute on function public.submit_evaluation(uuid, text, text, text, date) to authenticated;

revoke all on function public.my_given_evaluations() from public, anon;
grant execute on function public.my_given_evaluations() to authenticated;

revoke all on function public.team_dashboard() from public, anon;
grant execute on function public.team_dashboard() to authenticated;
