-- Identidade da turma (#56, ADR 0006 §2), versão sem upload de imagem do POC: lema, 2–3 cores e
-- emblema de um catálogo fixo. A "bandeira" é desenhada pelo app a partir das cores e do emblema.
-- Edita quem coordena a turma (líder) ou a coordenação do escopo; vê quem é da turma ou do escopo.

alter table public.units
  add column motto text check (motto is null or length(motto) between 1 and 80),
  add column colors text[] check (
    colors is null
    or (cardinality(colors) between 2 and 3 and array_to_string(colors, ',') ~ '^#[0-9a-f]{6}(,#[0-9a-f]{6}){1,2}$')
  ),
  add column emblem text check (
    emblem is null or emblem in ('estrela', 'escudo', 'tocha', 'livro', 'megafone', 'balanca', 'ponte', 'folha')
  );

create or replace function app.is_team_lead(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.unit_members as m
    where m.unit_id = p_team and m.profile_id = (select auth.uid()) and m.left_at is null and m.member_role = 'lead'
  )
$$;

create or replace function public.set_team_identity(p_team uuid, p_motto text, p_colors text[], p_emblem text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path extensions.ltree;
  v_type text;
  v_motto text := nullif(trim(coalesce(p_motto, '')), '');
  v_colors text[];
begin
  select u.path, t.key into v_path, v_type
  from public.units as u join public.unit_types as t on t.id = u.type_id
  where u.id = p_team;

  if v_path is null or v_type <> 'team' or not app.is_active_member()
     or not (app.is_team_lead(p_team) or app.has_scope_over(v_path, array['manager', 'monitor'])) then
    raise exception 'sem permissão para editar a identidade desta turma' using errcode = '42501';
  end if;

  if v_motto is not null and length(v_motto) > 80 then
    raise exception 'o lema tem até 80 letras' using errcode = '22023';
  end if;

  select array_agg(lower(trim(c)) order by ord) into v_colors
  from unnest(p_colors) with ordinality as x (c, ord);
  if v_colors is null or cardinality(v_colors) not between 2 and 3
     or exists (select 1 from unnest(v_colors) as c where c !~ '^#[0-9a-f]{6}$') then
    raise exception 'escolha de 2 a 3 cores no formato #RRGGBB' using errcode = '22023';
  end if;

  if p_emblem is null or p_emblem not in ('estrela', 'escudo', 'tocha', 'livro', 'megafone', 'balanca', 'ponte', 'folha') then
    raise exception 'emblema fora do catálogo' using errcode = '22023';
  end if;

  update public.units set motto = v_motto, colors = v_colors, emblem = p_emblem where id = p_team;
end;
$$;

create or replace function public.team_identity(p_team uuid)
returns table (motto text, colors text[], emblem text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.motto, u.colors, u.emblem
  from public.units as u
  where u.id = p_team
    and app.is_active_member()
    and (
      exists (
        select 1 from public.unit_members as m
        where m.unit_id = u.id and m.profile_id = (select auth.uid()) and m.left_at is null
      )
      or app.has_scope_over(u.path, array['manager', 'monitor'])
    )
$$;

revoke all on function app.is_team_lead(uuid) from public, anon, authenticated;
revoke all on function public.set_team_identity(uuid, text, text[], text), public.team_identity(uuid) from public, anon;
grant execute on function public.set_team_identity(uuid, text, text[], text), public.team_identity(uuid) to authenticated;
