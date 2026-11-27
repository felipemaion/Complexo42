-- Propostas de missão pela equipe (#57, ADR 0006 §5). Quem está numa equipe propõe (status
-- 'proposed', escopo = a própria equipe); a coordenação do escopo ajusta os pontos e publica, ou
-- recusa com justificativa (status 'archived' + decision_note). Até 5 propostas abertas por equipe.

alter table public.missions
  add column decision_note text check (decision_note is null or length(decision_note) between 3 and 300);

create or replace function public.propose_mission(p_title text, p_description text, p_category text, p_steps jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  team uuid := app.my_team();
  new_mission uuid;
  step jsonb;
  step_position smallint := 0;
begin
  if team is null or not app.is_active_member() then
    raise exception 'só quem está numa equipe propõe missão' using errcode = '42501';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 3 then
    raise exception 'a proposta precisa de 1 a 3 etapas' using errcode = '22023';
  end if;
  if (select count(*) from public.missions where proposed_by_unit_id = team and status = 'proposed') >= 5 then
    raise exception 'a equipe já tem 5 propostas esperando decisão' using errcode = 'C7614';
  end if;

  insert into public.missions (title, description, category, scope_unit_id, status, mode, proposed_by_unit_id, created_by)
  values (trim(p_title), coalesce(trim(p_description), ''), p_category, team, 'proposed', 'team', team, me)
  returning id into new_mission;

  for step in select value from jsonb_array_elements(p_steps)
  loop
    step_position := step_position + 1;
    insert into public.mission_steps (mission_id, position, title, points, evidence_type, requires_previous)
    values (new_mission, step_position, trim(step ->> 'title'), (step ->> 'points')::integer,
            coalesce(step ->> 'evidence_type', 'none'), step_position > 1);
  end loop;
  return new_mission;
end;
$$;

-- Propostas da equipe de quem pede (abertas, aprovadas e recusadas, com a justificativa).
create or replace function public.my_team_proposals()
returns table (id uuid, title text, status text, decision_note text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.title, m.status, m.decision_note, m.created_at
  from public.missions as m
  where app.is_active_member() and m.proposed_by_unit_id = app.my_team()
  order by m.created_at desc
$$;

-- Propostas abertas das equipes dentro do escopo da coordenação, com as etapas.
create or replace function public.pending_proposals()
returns table (id uuid, title text, description text, category text, team_id uuid, team_name text, parent_id uuid, steps jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.title, m.description, m.category, t.id, t.name, t.parent_id,
         (select jsonb_agg(jsonb_build_object('position', s.position, 'title', s.title, 'points', s.points, 'evidence_type', s.evidence_type) order by s.position)
          from public.mission_steps as s where s.mission_id = m.id),
         m.created_at
  from public.missions as m
  join public.units as t on t.id = m.proposed_by_unit_id
  where m.status = 'proposed' and t.parent_id is not null and app.can_publish_mission(t.parent_id)
  order by m.created_at
$$;

create or replace function public.decide_proposal(p_mission uuid, p_approve boolean, p_scope_unit uuid, p_points integer[], p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_parent uuid;
  v_scope uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_steps integer;
begin
  select m.proposed_by_unit_id, t.parent_id into v_team, v_parent
  from public.missions as m join public.units as t on t.id = m.proposed_by_unit_id
  where m.id = p_mission and m.status = 'proposed';

  if v_team is null or v_parent is null or not app.can_publish_mission(v_parent) then
    raise exception 'sem permissão para decidir esta proposta' using errcode = '42501';
  end if;

  if not p_approve then
    if v_note is null or length(v_note) not between 3 and 300 then
      raise exception 'a recusa precisa de uma justificativa' using errcode = '22023';
    end if;
    update public.missions set status = 'archived', decision_note = v_note where id = p_mission;
    return;
  end if;

  -- Publica para a própria equipe ou para um escopo maior da coordenação que contenha a equipe.
  v_scope := coalesce(p_scope_unit, v_team);
  if not exists (
    select 1 from public.units as s, public.units as t
    where s.id = v_scope and t.id = v_team and t.path operator(extensions.<@) s.path
  ) or (v_scope <> v_team and not app.can_publish_mission(v_scope)) then
    raise exception 'o escopo precisa conter a equipe e estar sob a sua coordenação' using errcode = '42501';
  end if;

  select count(*) into v_steps from public.mission_steps where mission_id = p_mission;
  if p_points is not null then
    if cardinality(p_points) <> v_steps or exists (select 1 from unnest(p_points) as p where p is null or p not between 1 and 1000) then
      raise exception 'um valor de 1 a 1000 para cada etapa' using errcode = '22023';
    end if;
    update public.mission_steps as s set points = p_points[s.position] where s.mission_id = p_mission;
  end if;

  update public.missions
  set status = 'published', scope_unit_id = v_scope, decision_note = v_note
  where id = p_mission;
end;
$$;

revoke all on function public.propose_mission(text, text, text, jsonb), public.my_team_proposals(), public.pending_proposals(),
  public.decide_proposal(uuid, boolean, uuid, integer[], text) from public, anon;
grant execute on function public.propose_mission(text, text, text, jsonb), public.my_team_proposals(), public.pending_proposals(),
  public.decide_proposal(uuid, boolean, uuid, integer[], text) to authenticated;
