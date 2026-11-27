-- Histórico de equipes da pessoa (#69, ADR 0007 §1–2): cada vínculo de equipe (aberto ou
-- encerrado) com os porta-vozes que a equipe teve naquele período. Só para a coordenação que tem
-- escopo sobre a equipe (o vínculo antigo nunca é apagado: mover encerra com left_at).

create or replace function public.person_history(p_profile uuid)
returns table (team_id uuid, team_name text, joined_at timestamptz, left_at timestamptz, spokespeople jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.name, m.joined_at, m.left_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('profile_id', r.profile_id, 'display_name_enc', p.display_name_enc) order by r.granted_at)
           from public.role_assignments as r
           join public.profiles as p on p.id = r.profile_id
           where r.unit_id = u.id and r.role = 'spokesperson'
             and r.granted_at <= coalesce(m.left_at, now())
             and (r.revoked_at is null or r.revoked_at >= m.joined_at)
         ), '[]'::jsonb)
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  join public.unit_types as t on t.id = u.type_id
  where m.profile_id = p_profile and t.key = 'team'
    and app.is_active_member()
    and p_profile <> (select auth.uid())
    and app.has_scope_over(u.path, array['manager', 'monitor'])
  order by m.joined_at
$$;

revoke all on function public.person_history(uuid) from public, anon;
grant execute on function public.person_history(uuid) to authenticated;
