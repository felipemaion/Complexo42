-- Novos tipos de medalha (#71, ADR 0007 §3): "evento" (quem organiza dá a quem participou) e
-- "marco" (leva o nome de quem conquistou primeiro e a história; depois todos que atingem ganham a
-- mesma). Os dois são concedidos à mão (grant_badge, com motivo). "Trabalhou com" e "presença"
-- dependem de ciclos e reuniões, que ainda não existem no modelo, e ficam para depois.

create or replace function public.create_special_badge(
  p_scope_unit uuid, p_name text, p_description text, p_icon text, p_rule_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path extensions.ltree;
  v_id uuid;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem criar medalhas' using errcode = '42501';
  end if;
  select path into v_path from public.units where id = p_scope_unit;
  if v_path is null or not app.has_scope_over(v_path, array['manager', 'monitor']) then
    raise exception 'Sem permissão de escopo para criar medalha nesta unidade' using errcode = '42501';
  end if;
  if p_rule_type not in ('event', 'milestone') then
    raise exception 'tipo de medalha especial desconhecido' using errcode = '22023';
  end if;
  insert into public.badges (scope_unit_id, created_by, name, description, icon, rule_type)
  values (p_scope_unit, auth.uid(), trim(p_name), coalesce(trim(p_description), ''), p_icon, p_rule_type)
  returning id into v_id;
  return v_id;
end;
$$;

-- Primeira conquista de um marco: a medalha passa a levar o nome de quem conquistou e a história.
create or replace function app.trg_milestone_first()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.badges
  set named_after_profile_id = new.profile_id, story = left(new.reason, 500)
  where id = new.badge_id and rule_type = 'milestone' and named_after_profile_id is null;
  return null;
end;
$$;

create trigger trg_profile_badges_milestone
after insert on public.profile_badges
for each row execute function app.trg_milestone_first();

revoke all on function app.trg_milestone_first() from public, anon, authenticated;
revoke all on function public.create_special_badge(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_special_badge(uuid, text, text, text, text) to authenticated;
