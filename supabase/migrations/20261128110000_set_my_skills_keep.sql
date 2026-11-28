-- Corrige `set_my_skills` (#340): reenviar uma habilidade que a pessoa já tem podia ser recusado com C7701. O gatilho
-- `profile_skills_limit` (BEFORE INSERT) dispara antes do `ON CONFLICT DO NOTHING` e conta as linhas existentes: com o
-- conjunto novo igual (ou quase) ao antigo, a linha "mantida" era contada contra o limite, de forma que dependia da ordem
-- dos ids (teste instável) e, com a pessoa já em 10, repetir o mesmo conjunto falhava sempre. A função agora insere só
-- as habilidades que faltam.

create or replace function public.set_my_skills(p_skill_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  ids uuid[];
begin
  if caller is null or not app.is_active_member() then
    raise exception 'só quem está ativo marca habilidades' using errcode = 'insufficient_privilege';
  end if;

  ids := coalesce(array(select distinct x from unnest(p_skill_ids) as x where x is not null), '{}');
  if cardinality(ids) > app.skills_per_person_max() then
    raise exception 'no máximo 10 habilidades por pessoa' using errcode = 'C7701';
  end if;

  perform 1 from public.profiles as p where p.id = caller for update;

  if exists (
    select 1 from unnest(ids) as i
    where not exists (
      select 1 from public.skills as s
      where s.id = i
        and (s.active or exists (select 1 from public.profile_skills as ps where ps.profile_id = caller and ps.skill_id = i))
    )
  ) then
    raise exception 'habilidade indisponível' using errcode = 'no_data_found';
  end if;

  delete from public.profile_skills where profile_id = caller and not (skill_id = any (ids));
  -- Só as que faltam: o gatilho do limite (BEFORE INSERT) roda antes do ON CONFLICT e contaria as linhas que a pessoa
  -- já tem (ou acabou de inserir) contra a própria habilidade mantida, recusando um conjunto válido (#340).
  insert into public.profile_skills (profile_id, skill_id)
  select caller, i from unnest(ids) as i
  where not exists (select 1 from public.profile_skills as ps where ps.profile_id = caller and ps.skill_id = i);
  return cardinality(ids);
end;
$$;
