-- Equipes de antes da plataforma (#136, ex-aluno): até 5 equipes de que a pessoa participou antes
-- de entrar na plataforma, com período e papel. Informadas pela própria pessoa, sem confirmação:
-- NÃO dão escopo, visibilidade nem acesso a ninguém. Não guarda colegas (seria dado de terceiros,
-- ADR 0007 §3). Quem vê: a própria pessoa e a coordenação do escopo dela, para montar equipes.
-- Dado da pessoa: some com a conta (cascade) e sai no "Baixar meus dados".

create table public.prior_teams (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  team_name text not null check (length(team_name) between 2 and 80),
  period text not null check (length(period) between 1 and 40),
  role text not null check (role in ('member', 'spokesperson', 'coordinator')),
  position smallint not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  -- Conferida no fim do comando (deferrable): ao tirar uma equipe, renumerar as de baixo não
  -- esbarra em "chave repetida" quando as linhas estão guardadas fora de ordem.
  unique (profile_id, position) deferrable initially immediate
);

alter table public.prior_teams enable row level security;

-- Leitura direta só da própria linha; o resto passa pelas funções abaixo. Sem escrita direta.
create policy prior_teams_select_own on public.prior_teams
  for select to authenticated using (profile_id = (select auth.uid()));

create or replace function public.add_prior_team(p_team_name text, p_period text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_team_name text := trim(coalesce(p_team_name, ''));
  v_period text := trim(coalesce(p_period, ''));
  v_count integer;
  v_id uuid;
begin
  if me is null or not app.is_active_member() then
    raise exception 'só membros ativos informam equipes anteriores' using errcode = '42501';
  end if;
  if length(v_team_name) not between 2 and 80 then
    raise exception 'o nome da equipe tem de 2 a 80 letras' using errcode = '22023';
  end if;
  if length(v_period) not between 1 and 40 then
    raise exception 'o período tem de 1 a 40 letras' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('member', 'spokesperson', 'coordinator') then
    raise exception 'papel desconhecido' using errcode = '22023';
  end if;

  -- Trava a lista da pessoa (mesmo vazia) para dois cliques seguidos não passarem de 5.
  perform pg_advisory_xact_lock(hashtextextended('prior_teams:' || me::text, 0));
  select count(*) into v_count from public.prior_teams where profile_id = me;
  if v_count >= 5 then
    raise exception 'a lista tem até 5 equipes anteriores' using errcode = '22023';
  end if;

  insert into public.prior_teams (profile_id, team_name, period, role, position)
  values (me, v_team_name, v_period, p_role, v_count + 1)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_prior_team(p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_position smallint;
begin
  delete from public.prior_teams where id = p_item and profile_id = me returning position into v_position;
  if v_position is null then
    raise exception 'só a dona ou o dono tira equipes anteriores' using errcode = '42501';
  end if;
  -- Os de baixo sobem uma posição (sem buracos).
  update public.prior_teams set position = position - 1 where profile_id = me and position > v_position;
end;
$$;

-- Equipes de uma pessoa: ela mesma ou a coordenação (gestão ou monitoria) com escopo sobre algum
-- vínculo aberto dela.
create or replace function public.prior_teams_list(p_profile uuid)
returns table (id uuid, team_name text, period text, role text, "position" smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.team_name, t.period, t.role, t.position
  from public.prior_teams as t
  where t.profile_id = p_profile
    and app.is_active_member()
    and (
      p_profile = (select auth.uid())
      or exists (
        select 1
        from public.unit_members as m
        join public.units as u on u.id = m.unit_id
        where m.profile_id = p_profile
          and m.left_at is null
          and app.has_scope_over(u.path, array['manager', 'monitor'])
      )
    )
  order by t.position
$$;

revoke all on function public.add_prior_team(text, text, text), public.remove_prior_team(uuid), public.prior_teams_list(uuid)
  from public, anon;
grant execute on function public.add_prior_team(text, text, text), public.remove_prior_team(uuid), public.prior_teams_list(uuid)
  to authenticated;
revoke all on public.prior_teams from public, anon, authenticated;
grant select on public.prior_teams to authenticated;

-- "Baixar meus dados" (#20, LGPD art. 18, II): a mesma função de 20261121001100_export_activity,
-- agora com as equipes de antes da plataforma (chave prior_teams, no fim). O resto não mudou.
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
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.export_own_activity() from public, anon;
grant execute on function public.export_own_activity() to authenticated;
