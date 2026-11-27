-- Portas das missões para o app (ADR 0006 §4–§5). O PostgREST só expõe o schema `public`
-- (supabase/config.toml), então as ações em `app.*` ganham aqui uma função fina, no mesmo
-- padrão de `public.accept_house`. A regra continua toda em `app.*` (R15).

create or replace function public.start_mission_run(p_mission uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.start_mission_run(p_mission);
$$;

create or replace function public.submit_step(
  p_run uuid,
  p_step uuid,
  p_evidence_url text default null,
  p_evidence_text text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.submit_step(p_run, p_step, p_evidence_url, p_evidence_text);
$$;

create or replace function public.review_submission(p_submission uuid, p_approve boolean, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.approve_submission(p_submission, p_approve, p_note);
$$;

-- Fila de validação: só as entregas que quem chama pode validar (papel no escopo e sem
-- participação, ADR 0006 §4). Nenhum dado pessoal: o nome é o da unidade.
create or replace function public.pending_reviews()
returns table (
  submission_id uuid,
  mission_title text,
  step_title text,
  step_points integer,
  evidence_type text,
  evidence_url text,
  evidence_text text,
  unit_name text,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, m.title, st.title, st.points, st.evidence_type, s.evidence_url, s.evidence_text,
         u.name, s.created_at
  from public.step_submissions as s
  join public.mission_runs as r on r.id = s.run_id
  join public.missions as m on m.id = r.mission_id
  join public.mission_steps as st on st.id = s.step_id
  join public.units as u on u.id = r.unit_id
  where s.status = 'submitted'
    and app.can_review_run(r.id)
    and s.submitted_by is distinct from (select auth.uid())
  order by s.created_at;
$$;

-- Unidades em que quem chama pode publicar missão (para o formulário de publicação).
create or replace function public.publishable_units()
returns table (id uuid, name text, depth integer)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.name, extensions.nlevel(u.path)
  from public.units as u
  where u.status = 'active' and app.can_publish_mission(u.id)
  order by u.path;
$$;

revoke all on function public.start_mission_run(uuid), public.submit_step(uuid, uuid, text, text),
  public.review_submission(uuid, boolean, text), public.pending_reviews(), public.publishable_units()
  from public, anon;

grant execute on function public.start_mission_run(uuid), public.submit_step(uuid, uuid, text, text),
  public.review_submission(uuid, boolean, text), public.pending_reviews(), public.publishable_units()
  to authenticated;

-- Publica a missão e as etapas numa transação só: nunca fica missão sem etapa (ADR 0006 §3).
-- `p_steps` = [{ "title": text, "points": int, "evidence_type": text }], de 1 a 3, em ordem.
create or replace function public.publish_mission(
  p_title text,
  p_description text,
  p_category text,
  p_scope_unit uuid,
  p_mode text,
  p_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  new_mission uuid;
  step jsonb;
  step_position smallint := 0;
begin
  if not app.can_publish_mission(p_scope_unit) then
    raise exception 'sem permissão para publicar nesta unidade' using errcode = '42501';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 3 then
    raise exception 'a missão precisa de 1 a 3 etapas' using errcode = '22023';
  end if;

  insert into public.missions (title, description, category, scope_unit_id, status, mode, created_by)
  values (trim(p_title), coalesce(trim(p_description), ''), p_category, p_scope_unit, 'published', p_mode, me)
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

revoke all on function public.publish_mission(text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.publish_mission(text, text, text, uuid, text, jsonb) to authenticated;
