-- Habilidades marcadas pela própria pessoa (#15). A tabela e a leitura já existiam
-- (20261120000000_skills); aqui entra a gravação: a pessoa escolhe do catálogo, só habilidades
-- ativas, no máximo 12. Desativar uma habilidade no catálogo não apaga quem já a tinha (#25):
-- trocar a lista só mexe nas ativas. Sem opção "outra" (não aprovada; seria texto livre).

create or replace function public.my_skills()
returns table (skill_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select ps.skill_id
  from public.profile_skills as ps
  where ps.profile_id = (select auth.uid()) and app.is_active_member()
$$;

create or replace function public.set_my_skills(p_skills uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_ids uuid[];
  v_count integer;
begin
  if me is null or not app.is_active_member() then
    raise exception 'só membros ativos marcam habilidades' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_skills, '{}')) as x where x is not null;
  if cardinality(v_ids) > 12 then
    raise exception 'até 12 habilidades' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as x
    where not exists (select 1 from public.skills as s where s.id = x and s.active)
  ) then
    raise exception 'habilidade fora do catálogo ativo' using errcode = '22023';
  end if;

  -- Dois envios seguidos da mesma pessoa não se cruzam.
  perform pg_advisory_xact_lock(hashtextextended('profile_skills:' || me::text, 0));
  delete from public.profile_skills as ps
  using public.skills as s
  where ps.profile_id = me and s.id = ps.skill_id and s.active and not (ps.skill_id = any (v_ids));
  insert into public.profile_skills (profile_id, skill_id)
  select me, x from unnest(v_ids) as x
  on conflict do nothing;

  select count(*) into v_count from public.profile_skills where profile_id = me;
  return v_count;
end;
$$;

revoke all on function public.my_skills(), public.set_my_skills(uuid[]) from public, anon;
grant execute on function public.my_skills(), public.set_my_skills(uuid[]) to authenticated;

-- "Baixar meus dados" (#20, LGPD art. 18, II): as habilidades marcadas passam a sair no arquivo.
-- Mesma função de 20261128002000_prior_teams, com a chave skills no fim. O resto não mudou.
create or replace function public.export_own_activity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', b.name,
        'reason', pb.reason,
        'awarded_at', pb.awarded_at,
        'revoked_at', pb.revoked_at,
        'revoked_reason', pb.revoked_reason
      ) order by pb.awarded_at, pb.id)
      from public.profile_badges as pb
      join public.badges as b on b.id = pb.badge_id
      where pb.profile_id = caller
    ), '[]'::jsonb),
    'portfolio', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', i.title,
        'kind', i.kind,
        'url_enc', i.url_enc,
        'created_at', i.created_at
      ) order by i.position)
      from public.portfolio_items as i
      where i.profile_id = caller
    ), '[]'::jsonb),
    'points_total', coalesce((select sum(l.points) from public.points_ledger as l where l.profile_id = caller), 0),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('points', l.points, 'reason', l.reason, 'created_at', l.created_at)
        order by l.created_at, l.id)
      from public.points_ledger as l
      where l.profile_id = caller
    ), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mission', m.title,
        'step', st.title,
        'status', s.status,
        'evidence_url', s.evidence_url,
        'evidence_text', s.evidence_text,
        'review_note', s.review_note,
        'created_at', s.created_at
      ) order by s.created_at, s.id)
      from public.step_submissions as s
      join public.mission_steps as st on st.id = s.step_id
      join public.missions as m on m.id = st.mission_id
      where s.submitted_by = caller
    ), '[]'::jsonb),
    'team_messages', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', t.unit_id, 'body_enc', t.body_enc, 'created_at', t.created_at)
        order by t.created_at, t.id)
      from public.team_messages as t
      where t.author_id = caller
    ), '[]'::jsonb),
    'prior_teams', coalesce((
      select jsonb_agg(jsonb_build_object('team_name', p.team_name, 'period', p.period, 'role', p.role, 'created_at', p.created_at)
        order by p.position)
      from public.prior_teams as p
      where p.profile_id = caller
    ), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'category', s.category) order by s.category, s.name)
      from public.profile_skills as ps
      join public.skills as s on s.id = ps.skill_id
      where ps.profile_id = caller
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.export_own_activity() from public, anon;
grant execute on function public.export_own_activity() to authenticated;
