-- Medalhas automáticas (#36, ADR 0006 §8, ADR 0007 §3): "missão concluída" e "limite de pontos".
-- A coordenação cria a medalha com a regra; o banco concede sozinho a quem cumpre a regra e está
-- dentro do escopo da medalha. Uma vez só por pessoa; medalha revogada não volta sozinha.

create or replace function public.create_auto_badge(
  p_scope_unit uuid,
  p_name text,
  p_description text,
  p_icon text,
  p_rule_type text,
  p_mission uuid default null,
  p_points integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_path extensions.ltree;
  v_params jsonb;
  v_badge_id uuid;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem criar medalhas' using errcode = '42501';
  end if;

  select path into v_unit_path from public.units where id = p_scope_unit;
  if v_unit_path is null or not app.has_scope_over(v_unit_path, array['manager', 'monitor']) then
    raise exception 'Sem permissão de escopo para criar medalha nesta unidade' using errcode = '42501';
  end if;

  if p_rule_type = 'points_threshold' then
    if p_points is null or p_points not between 1 and 100000 then
      raise exception 'o limite de pontos vai de 1 a 100000' using errcode = '22023';
    end if;
    v_params := jsonb_build_object('points', p_points);
  elsif p_rule_type = 'mission_completed' then
    if p_mission is null or not exists (select 1 from public.missions where id = p_mission) then
      raise exception 'escolha a missão que dá a medalha' using errcode = '22023';
    end if;
    v_params := jsonb_build_object('mission_id', p_mission);
  else
    raise exception 'regra automática desconhecida' using errcode = '22023';
  end if;

  insert into public.badges (scope_unit_id, created_by, name, description, icon, rule_type, rule_params)
  values (p_scope_unit, auth.uid(), trim(p_name), coalesce(trim(p_description), ''), p_icon, p_rule_type, v_params)
  returning id into v_badge_id;

  return v_badge_id;
end;
$$;

revoke all on function public.create_auto_badge(uuid, text, text, text, text, uuid, integer) from public, anon;
grant execute on function public.create_auto_badge(uuid, text, text, text, text, uuid, integer) to authenticated;

-- Concede as medalhas automáticas que a pessoa já conquistou. Só o banco chama (gatilhos).
create or replace function app.award_auto_badges(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  select coalesce(sum(points), 0) into v_total from public.points_ledger where profile_id = p_profile;

  insert into public.profile_badges (profile_id, badge_id, reason)
  select p_profile, b.id, left('Conquista automática: ' || b.name, 300)
  from public.badges as b
  join public.units as scope on scope.id = b.scope_unit_id
  where (
      (b.rule_type = 'points_threshold' and v_total >= (b.rule_params ->> 'points')::integer)
      or (b.rule_type = 'mission_completed' and exists (
        select 1
        from public.mission_runs as r
        join public.mission_run_members as rm on rm.run_id = r.id
        where rm.profile_id = p_profile
          and r.status = 'completed'
          and r.mission_id = (b.rule_params ->> 'mission_id')::uuid
      ))
    )
    -- Só quem está dentro do escopo da medalha.
    and exists (
      select 1
      from public.unit_members as m
      join public.units as u on u.id = m.unit_id
      where m.profile_id = p_profile and m.left_at is null
        and u.path operator(extensions.<@) scope.path
    )
    -- Uma vez só; revogada não volta sozinha.
    and not exists (
      select 1 from public.profile_badges as pb where pb.profile_id = p_profile and pb.badge_id = b.id
    );
end;
$$;

create or replace function app.trg_auto_badges_on_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is not null then
    perform app.award_auto_badges(new.profile_id);
  end if;
  return null;
end;
$$;

create or replace function app.trg_auto_badges_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  for v_member in select rm.profile_id from public.mission_run_members as rm where rm.run_id = new.id loop
    perform app.award_auto_badges(v_member);
  end loop;
  return null;
end;
$$;

create trigger trg_points_ledger_auto_badges
after insert on public.points_ledger
for each row execute function app.trg_auto_badges_on_points();

create trigger trg_mission_runs_auto_badges
after update of status on public.mission_runs
for each row when (new.status = 'completed' and old.status is distinct from 'completed')
execute function app.trg_auto_badges_on_completion();

revoke all on function app.award_auto_badges(uuid), app.trg_auto_badges_on_points(), app.trg_auto_badges_on_completion()
  from public, anon, authenticated;
