-- Missões, etapas, execuções, entregas e livro-razão de pontos (ADR 0006 §3–§5, issues #30,
-- #31, #32 e #33).
--
-- Regras desta migration:
-- 1. Visibilidade (ADR 0006 §3): a missão publicada aparece na unidade do escopo e abaixo dela.
--    Proposta (§5) só para a equipe que propôs e para quem tem papel sobre ela.
-- 2. Quem publica: manager ou monitor com escopo sobre a unidade (§5). A origem é gravada por
--    trigger: manager da raiz = `national`; qualquer outro = `regional` (§3).
-- 3. Execução, entrega e aprovação só por funções (`app.start_mission_run`,
--    `app.submit_step`, `app.approve_submission`): o cliente não grava status nem pontos.
-- 4. Livro-razão só-inserção (§4): trigger bloqueia update e delete. A única atualização aceita
--    é o nulo da cascata quando a conta é excluída (MODELO_DADOS, "Exclusão da conta").
-- 5. Antifraude (§4): ninguém aprova entrega de execução da qual participou; a mesma etapa não
--    é aprovada duas vezes na mesma execução (índice único parcial).
-- 6. Sem upload (§7): evidência é link https, número de protocolo ou texto curto.

-- ---------------------------------------------------------------------------------------
-- Funções de apoio
-- ---------------------------------------------------------------------------------------

-- A equipe aberta de quem chama: vínculo ativo numa unidade de tipo equipe (ADR 0010, #119).
create or replace function app.my_team()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.unit_id
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  join public.unit_types as t on t.id = u.type_id
  where m.profile_id = (select auth.uid())
    and m.left_at is null
    and t.is_team
  order by m.joined_at desc
  limit 1;
$$;

comment on function app.my_team() is
  'Equipe aberta de quem chama (unidade de tipo equipe), ou nulo.';

-- Quem chama tem vínculo ativo numa unidade dentro de `scope_path`?
create or replace function app.is_member_within(scope_path extensions.ltree)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.unit_members as m
    join public.units as u on u.id = m.unit_id
    where m.profile_id = (select auth.uid())
      and m.left_at is null
      and u.path operator(extensions.<@) scope_path
  );
$$;

-- ---------------------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------------------

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 3 and 120),
  description text not null default '' check (length(description) <= 2000),
  category text not null check (category ~ '^[a-z][a-z0-9_]{0,31}$'),
  scope_unit_id uuid not null references public.units (id) on delete restrict,
  status text not null default 'proposed' check (status in ('proposed', 'published', 'archived')),
  -- Gravada pelo trigger a partir do papel de quem cria (ADR 0006 §3).
  origin text not null default 'regional' check (origin in ('national', 'regional')),
  mode text not null default 'team' check (mode in ('individual', 'team')),
  repeatable boolean not null default false,
  cooldown_days integer check (cooldown_days between 1 and 365),
  -- FK para `badges` entra com a #34.
  badge_id uuid,
  proposed_by_unit_id uuid references public.units (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint missions_cooldown_needs_repeatable check (cooldown_days is null or repeatable)
);

comment on table public.missions is
  'Catálogo de missões (ADR 0006 §3). Visível na unidade do escopo e abaixo dela.';

create index missions_scope_status_idx on public.missions (scope_unit_id, status);

create table public.mission_steps (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  position smallint not null check (position between 1 and 20),
  title text not null check (length(title) between 3 and 120),
  description text not null default '' check (length(description) <= 1000),
  points integer not null check (points between 1 and 1000),
  evidence_type text not null default 'none'
    check (evidence_type in ('none', 'link', 'protocol_number', 'text')),
  requires_previous boolean not null default false,
  constraint mission_steps_position_key unique (mission_id, position)
);

create table public.mission_runs (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete restrict,
  unit_id uuid not null references public.units (id) on delete restrict,
  -- Missão individual: a pessoa dona da execução. `set null` na exclusão da conta: a contagem
  -- da unidade fica, sem dono (MODELO_DADOS).
  profile_id uuid references auth.users (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint mission_runs_completed_at check ((status = 'completed') = (completed_at is not null))
);

create unique index mission_runs_one_active_team
  on public.mission_runs (mission_id, unit_id)
  where status = 'active' and profile_id is null;

create unique index mission_runs_one_active_individual
  on public.mission_runs (mission_id, profile_id)
  where status = 'active' and profile_id is not null;

create table public.mission_run_members (
  run_id uuid not null references public.mission_runs (id) on delete cascade,
  -- Dado da pessoa: some com a conta (MODELO_DADOS).
  profile_id uuid not null references auth.users (id) on delete cascade,
  primary key (run_id, profile_id)
);

create index mission_run_members_profile_idx on public.mission_run_members (profile_id);

create table public.step_submissions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.mission_runs (id) on delete restrict,
  step_id uuid not null references public.mission_steps (id) on delete restrict,
  submitted_by uuid references auth.users (id) on delete set null,
  evidence_url text check (evidence_url ~ '^https://[^[:space:]]+$' and length(evidence_url) <= 500),
  -- "Não inclua dados de outras pessoas" (ADR 0006 §7): aviso na tela; o texto some se a
  -- conta de quem enviou for excluída (trigger abaixo).
  evidence_text text check (length(evidence_text) between 1 and 500),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 500),
  created_at timestamptz not null default now(),
  constraint step_submissions_review_fields
    check ((status = 'submitted') = (reviewed_at is null))
);

-- Antifraude (ADR 0006 §4): a mesma etapa não é aprovada duas vezes na mesma execução.
create unique index step_submissions_one_approved
  on public.step_submissions (run_id, step_id)
  where status = 'approved';

-- Uma entrega pendente por etapa e execução.
create unique index step_submissions_one_pending
  on public.step_submissions (run_id, step_id)
  where status = 'submitted';

create table public.points_ledger (
  id bigint generated always as identity primary key,
  unit_id uuid not null references public.units (id) on delete restrict,
  -- Nulo = lançamento da unidade; preenchido = lançamento individual (ADR 0006 §4).
  profile_id uuid references auth.users (id) on delete set null,
  submission_id uuid references public.step_submissions (id) on delete restrict,
  points integer not null check (points <> 0),
  reason text not null check (length(reason) between 3 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.points_ledger is
  'Livro-razão de pontos: só inserção, por função (ADR 0006 §4). Correção = lançamento negativo.';

create index points_ledger_unit_idx on public.points_ledger (unit_id, created_at);
create index points_ledger_profile_idx on public.points_ledger (profile_id) where profile_id is not null;

-- ---------------------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------------------

-- Origem pela pessoa que cria, nunca pelo formulário (ADR 0006 §3).
create or replace function app.tg_missions_set_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.origin := case when app.manages_root() then 'national' else 'regional' end;
  return new;
end;
$$;

create trigger missions_set_origin
  before insert on public.missions
  for each row execute function app.tg_missions_set_origin();

-- Livro-razão só-inserção. Aceita apenas o nulo da cascata da exclusão da conta.
create or replace function app.tg_points_ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.id = old.id
     and new.unit_id = old.unit_id
     and new.submission_id is not distinct from old.submission_id
     and new.points = old.points
     and new.reason = old.reason
     and new.created_at = old.created_at
     and (new.profile_id is null or new.profile_id = old.profile_id)
     and (new.created_by is null or new.created_by = old.created_by) then
    return new;
  end if;
  raise exception 'o livro-razão de pontos é só-inserção; corrija com um lançamento negativo'
    using errcode = '42501';
end;
$$;

create trigger points_ledger_append_only
  before update or delete on public.points_ledger
  for each row execute function app.tg_points_ledger_append_only();

-- Texto livre de quem excluiu a conta não fica (MODELO_DADOS, "Texto livre que possa
-- identificar a pessoa numa linha que fica").
create or replace function app.tg_step_submissions_forget_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.submitted_by is not null and new.submitted_by is null then
    new.evidence_text := null;
  end if;
  return new;
end;
$$;

create trigger step_submissions_forget_author
  before update of submitted_by on public.step_submissions
  for each row execute function app.tg_step_submissions_forget_author();

-- ---------------------------------------------------------------------------------------
-- 3. Funções de acesso (R15)
-- ---------------------------------------------------------------------------------------

-- Pode publicar ou editar missões no escopo desta unidade?
create or replace function app.can_publish_mission(target_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1 from public.units as u
      where u.id = target_unit
        and app.has_scope_over(u.path, array['manager', 'monitor'])
    );
$$;

-- Pode gerenciar a missão (editar, publicar proposta, arquivar)?
create or replace function app.can_manage_mission(p_mission uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.missions as m
    where m.id = p_mission
      and (
        app.can_publish_mission(m.scope_unit_id)
        or (m.status = 'proposed' and app.can_publish_mission(m.proposed_by_unit_id))
      )
  );
$$;

create or replace function app.can_view_mission(p_mission uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1
      from public.missions as m
      join public.units as s on s.id = m.scope_unit_id
      where m.id = p_mission
        and (
          app.can_manage_mission(m.id)
          or (
            m.status = 'published'
            and (
              app.is_member_within(s.path)
              or exists (
                select 1 from app.my_scopes() as sc
                where sc.unit_path operator(extensions.<@) s.path
                   or s.path operator(extensions.<@) sc.unit_path
              )
            )
          )
          or (m.status = 'proposed' and m.proposed_by_unit_id = app.my_team())
        )
    );
$$;

-- Pode ver a execução (e as suas entregas)? Quem participa, a equipe dona, ou quem tem papel
-- sobre a unidade da execução.
create or replace function app.can_view_run(p_run uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1
      from public.mission_runs as r
      join public.units as u on u.id = r.unit_id
      where r.id = p_run
        and (
          exists (
            select 1 from public.mission_run_members as rm
            where rm.run_id = r.id and rm.profile_id = (select auth.uid())
          )
          or (r.profile_id is null and r.unit_id = app.my_team())
          or app.has_scope_over(u.path, array['manager', 'monitor', 'spokesperson'])
        )
    );
$$;

-- Pode aprovar entregas desta execução? Papel de validação e nenhuma participação (§4).
create or replace function app.can_review_run(p_run uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1
      from public.mission_runs as r
      join public.units as u on u.id = r.unit_id
      where r.id = p_run
        and app.has_scope_over(u.path, array['manager', 'monitor'])
        and not exists (
          select 1 from public.mission_run_members as rm
          where rm.run_id = r.id and rm.profile_id = (select auth.uid())
        )
        and r.profile_id is distinct from (select auth.uid())
    );
$$;

-- Pode ver os pontos desta unidade? Membros da unidade e quem tem escopo sobre ela.
create or replace function app.can_view_unit_points(target_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1 from public.units as u
      where u.id = target_unit
        and (
          app.is_member_within(u.path)
          or app.has_scope_over(u.path, array['manager', 'monitor', 'spokesperson'])
        )
    );
$$;

-- ---------------------------------------------------------------------------------------
-- 4. Ações (só por função)
-- ---------------------------------------------------------------------------------------

-- A equipe (ou a pessoa, na missão individual) assume a missão publicada.
create or replace function app.start_mission_run(p_mission uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  mission public.missions%rowtype;
  team uuid := app.my_team();
  run_unit uuid;
  run_owner uuid;
  existing uuid;
  last_done timestamptz;
  new_run uuid;
begin
  select * into mission from public.missions where id = p_mission;
  if mission.id is null or mission.status <> 'published' or not app.can_view_mission(p_mission) then
    raise exception 'missão indisponível' using errcode = '42501';
  end if;
  if not app.is_member_within((select u.path from public.units as u where u.id = mission.scope_unit_id)) then
    raise exception 'só quem está no escopo da missão pode assumi-la' using errcode = '42501';
  end if;

  if mission.mode = 'team' then
    if team is null then
      raise exception 'é preciso estar numa equipe para assumir esta missão' using errcode = '42501';
    end if;
    run_unit := team;
    run_owner := null;
  else
    run_unit := coalesce(team, (
      select m.unit_id from public.unit_members as m
      where m.profile_id = me and m.left_at is null
      order by m.joined_at desc limit 1
    ));
    run_owner := me;
  end if;

  -- Já em andamento: devolve a mesma execução (idempotente).
  select r.id into existing
  from public.mission_runs as r
  where r.mission_id = p_mission and r.status = 'active'
    and r.unit_id = run_unit and r.profile_id is not distinct from run_owner;
  if existing is not null then
    return existing;
  end if;

  select max(r.completed_at) into last_done
  from public.mission_runs as r
  where r.mission_id = p_mission and r.status = 'completed'
    and r.unit_id = run_unit and r.profile_id is not distinct from run_owner;
  if last_done is not null and not mission.repeatable then
    raise exception 'esta missão já foi concluída e não se repete' using errcode = 'P0001';
  end if;
  if last_done is not null and mission.cooldown_days is not null
     and last_done > now() - make_interval(days => mission.cooldown_days) then
    raise exception 'esta missão só pode ser repetida depois do intervalo mínimo' using errcode = 'P0001';
  end if;

  insert into public.mission_runs (mission_id, unit_id, profile_id)
  values (p_mission, run_unit, run_owner)
  returning id into new_run;

  if mission.mode = 'team' then
    insert into public.mission_run_members (run_id, profile_id)
    select new_run, m.profile_id
    from public.unit_members as m
    where m.unit_id = run_unit and m.left_at is null;
  else
    insert into public.mission_run_members (run_id, profile_id) values (new_run, me);
  end if;

  return new_run;
end;
$$;

-- Entrega de uma etapa, com a evidência do tipo que a etapa pede (ADR 0006 §3 e §7).
create or replace function app.submit_step(
  p_run uuid,
  p_step uuid,
  p_evidence_url text default null,
  p_evidence_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  run public.mission_runs%rowtype;
  step public.mission_steps%rowtype;
  evidence_url text := nullif(trim(coalesce(p_evidence_url, '')), '');
  evidence_text text := nullif(trim(coalesce(p_evidence_text, '')), '');
  new_submission uuid;
begin
  select * into run from public.mission_runs where id = p_run;
  if run.id is null or not app.is_active_member() or not exists (
    select 1 from public.mission_run_members as rm where rm.run_id = p_run and rm.profile_id = me
  ) then
    raise exception 'só quem participa da execução pode entregar' using errcode = '42501';
  end if;
  if run.status <> 'active' then
    raise exception 'a execução não está em andamento' using errcode = 'P0001';
  end if;

  select * into step from public.mission_steps where id = p_step and mission_id = run.mission_id;
  if step.id is null then
    raise exception 'etapa não pertence a esta missão' using errcode = 'P0001';
  end if;

  if step.requires_previous and exists (
    select 1 from public.mission_steps as prev
    where prev.mission_id = step.mission_id
      and prev.position < step.position
      and not exists (
        select 1 from public.step_submissions as s
        where s.run_id = p_run and s.step_id = prev.id and s.status = 'approved'
      )
  ) then
    raise exception 'esta etapa só abre depois das anteriores aprovadas' using errcode = 'P0001';
  end if;

  if step.evidence_type = 'none' then
    evidence_url := null;
    evidence_text := null;
  elsif step.evidence_type = 'link' and (evidence_url is null or evidence_url !~ '^https://[^[:space:]]+$') then
    raise exception 'esta etapa pede um link que comece com https://' using errcode = '22023';
  elsif step.evidence_type = 'protocol_number'
        and (evidence_text is null or evidence_text !~ '^[A-Za-z0-9./ -]{3,60}$') then
    raise exception 'esta etapa pede o número de protocolo' using errcode = '22023';
  elsif step.evidence_type = 'text' and evidence_text is null then
    raise exception 'esta etapa pede um texto curto' using errcode = '22023';
  end if;

  insert into public.step_submissions (run_id, step_id, submitted_by, evidence_url, evidence_text)
  values (p_run, p_step, me, evidence_url, evidence_text)
  returning id into new_submission;

  return new_submission;
end;
$$;

-- Aprova ou recusa uma entrega e lança os pontos na mesma transação (ADR 0006 §4).
create or replace function app.approve_submission(
  p_submission uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  submission public.step_submissions%rowtype;
  run public.mission_runs%rowtype;
  step_points integer;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into submission from public.step_submissions where id = p_submission for update;
  if submission.id is null then
    raise exception 'entrega não encontrada' using errcode = 'P0002';
  end if;
  select * into run from public.mission_runs where id = submission.run_id;

  if not app.can_review_run(run.id) or submission.submitted_by = me then
    raise exception 'sem permissão para validar esta entrega' using errcode = '42501';
  end if;
  if submission.status <> 'submitted' then
    raise exception 'esta entrega já foi validada' using errcode = 'P0001';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'o comentário passa de 500 caracteres' using errcode = '22023';
  end if;

  update public.step_submissions
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = me,
      reviewed_at = now(),
      review_note = note
  where id = p_submission;

  insert into public.audit_log (actor_id, event, target_id)
  values (me, case when p_approve then 'submission_approved' else 'submission_rejected' end, p_submission);

  if not p_approve then
    return;
  end if;

  select s.points into step_points from public.mission_steps as s where s.id = submission.step_id;

  -- A unidade recebe os pontos da etapa; cada participante recebe os individuais (§4).
  insert into public.points_ledger (unit_id, profile_id, submission_id, points, reason, created_by)
  values (run.unit_id, null, p_submission, step_points, 'etapa aprovada', me);

  insert into public.points_ledger (unit_id, profile_id, submission_id, points, reason, created_by)
  select run.unit_id, rm.profile_id, p_submission, step_points, 'etapa aprovada', me
  from public.mission_run_members as rm
  where rm.run_id = run.id;

  -- Todas as etapas aprovadas: a execução termina.
  if not exists (
    select 1 from public.mission_steps as st
    where st.mission_id = run.mission_id
      and not exists (
        select 1 from public.step_submissions as s
        where s.run_id = run.id and s.step_id = st.id and s.status = 'approved'
      )
  ) then
    update public.mission_runs set status = 'completed', completed_at = now() where id = run.id;
  end if;
end;
$$;

-- Correção de pontos: lançamento (negativo ou positivo) com motivo, nunca edição (ADR 0006 §4).
create or replace function app.adjust_points(
  p_unit uuid,
  p_profile uuid,
  p_points integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not app.is_active_member() or not exists (
    select 1 from public.units as u
    where u.id = p_unit and app.has_scope_over(u.path, array['manager', 'monitor'])
  ) then
    raise exception 'sem permissão para corrigir pontos desta unidade' using errcode = '42501';
  end if;
  if p_profile = me then
    raise exception 'ninguém corrige os próprios pontos' using errcode = '42501';
  end if;
  if reason is null or length(reason) < 3 or length(reason) > 200 or coalesce(p_points, 0) = 0 then
    raise exception 'informe os pontos (diferente de zero) e o motivo' using errcode = '22023';
  end if;

  insert into public.points_ledger (unit_id, profile_id, submission_id, points, reason, created_by)
  values (p_unit, p_profile, null, p_points, reason, me);

  insert into public.audit_log (actor_id, event, target_id)
  values (me, 'points_adjusted', p_unit);
end;
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Permissões e RLS (R5): o cliente lê; grava só missão/etapa e pelas funções.
-- ---------------------------------------------------------------------------------------

alter table public.missions enable row level security;
alter table public.mission_steps enable row level security;
alter table public.mission_runs enable row level security;
alter table public.mission_run_members enable row level security;
alter table public.step_submissions enable row level security;
alter table public.points_ledger enable row level security;

revoke all on public.missions, public.mission_steps, public.mission_runs,
  public.mission_run_members, public.step_submissions, public.points_ledger
  from anon, authenticated;

grant select on public.missions, public.mission_steps, public.mission_runs,
  public.mission_run_members, public.step_submissions, public.points_ledger
  to authenticated;

grant insert (title, description, category, scope_unit_id, status, mode, repeatable,
  cooldown_days, proposed_by_unit_id, created_by) on public.missions to authenticated;
grant update (title, description, category, status, mode, repeatable, cooldown_days)
  on public.missions to authenticated;
grant insert, update, delete on public.mission_steps to authenticated;

create policy missions_select on public.missions
  for select to authenticated
  using (app.can_view_mission(id));

-- Publicar direto: papel de validação no escopo. Propor: membro ativo, para a própria equipe.
create policy missions_insert on public.missions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (status = 'published' and proposed_by_unit_id is null and app.can_publish_mission(scope_unit_id))
      or (
        status = 'proposed'
        and app.is_active_member()
        and proposed_by_unit_id = app.my_team()
        and scope_unit_id = proposed_by_unit_id
      )
    )
  );

create policy missions_update on public.missions
  for update to authenticated
  using (app.can_manage_mission(id))
  with check (app.can_publish_mission(scope_unit_id) or (status = 'proposed' and app.can_manage_mission(id)));

-- Etapas seguem a missão. A equipe edita as etapas da própria proposta.
create policy mission_steps_select on public.mission_steps
  for select to authenticated
  using (app.can_view_mission(mission_id));

create policy mission_steps_write on public.mission_steps
  for all to authenticated
  using (
    app.can_manage_mission(mission_id)
    or exists (
      select 1 from public.missions as m
      where m.id = mission_id and m.status = 'proposed'
        and m.created_by = (select auth.uid()) and m.proposed_by_unit_id = app.my_team()
    )
  )
  with check (
    app.can_manage_mission(mission_id)
    or exists (
      select 1 from public.missions as m
      where m.id = mission_id and m.status = 'proposed'
        and m.created_by = (select auth.uid()) and m.proposed_by_unit_id = app.my_team()
    )
  );

create policy mission_runs_select on public.mission_runs
  for select to authenticated
  using (app.can_view_run(id));

create policy mission_run_members_select on public.mission_run_members
  for select to authenticated
  using (app.can_view_run(run_id));

create policy step_submissions_select on public.step_submissions
  for select to authenticated
  using (app.can_view_run(run_id));

create policy points_ledger_select on public.points_ledger
  for select to authenticated
  using (profile_id = (select auth.uid()) or app.can_view_unit_points(unit_id));

revoke all on function app.my_team(), app.is_member_within(extensions.ltree),
  app.can_publish_mission(uuid), app.can_manage_mission(uuid), app.can_view_mission(uuid),
  app.can_view_run(uuid), app.can_review_run(uuid), app.can_view_unit_points(uuid),
  app.start_mission_run(uuid), app.submit_step(uuid, uuid, text, text),
  app.approve_submission(uuid, boolean, text), app.adjust_points(uuid, uuid, integer, text)
  from public;

grant execute on function app.my_team(), app.is_member_within(extensions.ltree),
  app.can_publish_mission(uuid), app.can_manage_mission(uuid), app.can_view_mission(uuid),
  app.can_view_run(uuid), app.can_review_run(uuid), app.can_view_unit_points(uuid),
  app.start_mission_run(uuid), app.submit_step(uuid, uuid, text, text),
  app.approve_submission(uuid, boolean, text), app.adjust_points(uuid, uuid, integer, text)
  to authenticated;

-- Funções de trigger não são chamadas por ninguém (padrão das outras migrations).
revoke execute on function app.tg_missions_set_origin(), app.tg_points_ledger_append_only(),
  app.tg_step_submissions_forget_author()
  from public, anon, authenticated;
