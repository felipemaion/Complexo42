-- Mover pessoa de uma equipe para outra (#47, ADR 0006 §2: "pode ser movido de uma turma para
-- outra; gera um evento"). Só quem coordena as duas equipes; a pessoa precisa estar na origem.
-- Uma equipe por pessoa (o índice unit_members_one_open_per_profile garante); vai para o audit_log.

create or replace function public.move_to_team(p_profile uuid, p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_from = p_to then
    raise exception 'origem e destino precisam ser diferentes' using errcode = '22023';
  end if;
  if not app.is_active_member() or not app.can_manage_unit(p_from) or not app.can_manage_unit(p_to)
     or not exists (
       select 1 from public.units as u join public.unit_types as t on t.id = u.type_id
       where u.id = p_to and t.key = 'team' and u.status = 'active'
     ) then
    raise exception 'sem permissão para mover para esta equipe' using errcode = '42501';
  end if;

  update public.unit_members set left_at = now()
  where profile_id = p_profile and unit_id = p_from and left_at is null;
  if not found then
    raise exception 'a pessoa não está na equipe de origem' using errcode = '42501';
  end if;

  insert into public.unit_members (unit_id, profile_id, member_role) values (p_to, p_profile, 'member');
  insert into public.audit_log (actor_id, event, target_id) values ((select auth.uid()), 'member_moved', p_profile);
end;
$$;

revoke all on function public.move_to_team(uuid, uuid, uuid) from public, anon;
grant execute on function public.move_to_team(uuid, uuid, uuid) to authenticated;
