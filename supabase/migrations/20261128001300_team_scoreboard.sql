-- Placar de equipes por escopo e período (#58, ADR 0006 §6). Soma as linhas da EQUIPE no
-- livro-razão (profile_id nulo), nunca de pessoas: sem ranking individual. Vê quem está dentro do
-- escopo ou o coordena. Sem escopo, usa a unidade de cima da própria equipe (a região).

create index idx_points_ledger_team_period on public.points_ledger (unit_id, created_at) where profile_id is null;

create or replace function public.team_scoreboard(p_scope uuid, p_days integer)
returns table (team_id uuid, team_name text, points integer, is_mine boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope uuid := coalesce(p_scope, (select u.parent_id from public.units as u where u.id = app.my_team()));
  v_path extensions.ltree;
  v_mine uuid := app.my_team();
begin
  if p_days is not null and p_days not between 1 and 3650 then
    raise exception 'o período vai de 1 a 3650 dias' using errcode = '22023';
  end if;
  select u.path into v_path from public.units as u where u.id = v_scope;
  if v_path is null or not app.is_active_member()
     or not (app.is_member_within(v_path) or app.has_scope_over(v_path, array['manager', 'monitor'])) then
    return;
  end if;

  return query
  select t.id, t.name,
         coalesce((
           select sum(l.points)::integer from public.points_ledger as l
           where l.unit_id = t.id and l.profile_id is null
             and (p_days is null or l.created_at >= now() - make_interval(days => p_days))
         ), 0),
         t.id = v_mine
  from public.units as t
  join public.unit_types as ty on ty.id = t.type_id
  where ty.key = 'team' and t.status = 'active' and t.path operator(extensions.<@) v_path
  order by 3 desc, t.name;
end;
$$;

revoke all on function public.team_scoreboard(uuid, integer) from public, anon;
grant execute on function public.team_scoreboard(uuid, integer) to authenticated;
