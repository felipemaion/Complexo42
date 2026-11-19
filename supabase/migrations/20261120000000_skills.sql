-- Habilidades (issue #8; a seleção pela pessoa é a #15). Só o esquema: o catálogo em si não
-- vem aqui, porque ainda está PROVISÓRIO (aguarda a aprovação do stakeholder). No local ele
-- entra por `supabase/seeds/skills_catalog.sql`; em produção, por migration depois da
-- aprovação.
--
-- 1. `skills`: catálogo (texto puro, sem dado pessoal). `aliases` são os sinônimos da busca.
-- 2. `profile_skills`: quais habilidades cada pessoa marcou. Sem `level`: o nível (só "tenho"
--    ou básico/intermediário/avançado) é decisão em aberto; escolhido o padrão mais simples.
-- 3. Leitura: o catálogo, qualquer pessoa logada e ativa; as habilidades de alguém, quem pode
--    ver o perfil (`app.can_view_profile`, R15). Nada é gravado pela API ainda: a gravação
--    (com o limite por pessoa e a opção "outra") entra na #15.

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80 and name = btrim(name)),
  category text not null check (char_length(category) between 2 and 80 and category = btrim(category)),
  -- Sinônimos para a busca (ex.: "oratória" para "Falar em público").
  aliases text[] not null default '{}',
  active boolean not null default true,
  constraint skills_name_key unique (name)
);

comment on table public.skills is
  'Catálogo de habilidades. Referência sem dado pessoal; só leitura pela API.';

-- Busca por sinônimo no banco (docs/MODELO_DADOS.md).
create index skills_aliases_idx on public.skills using gin (aliases);

alter table public.skills enable row level security;

revoke all on public.skills from anon, authenticated;
grant select on public.skills to authenticated;

create policy skills_select on public.skills
  for select to authenticated
  using (app.is_active_member());

create table public.profile_skills (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  skill_id uuid not null references public.skills (id),
  primary key (profile_id, skill_id)
);

comment on table public.profile_skills is
  'Habilidades que a pessoa marcou. Apagadas junto com o perfil (exclusão de conta).';

create index profile_skills_skill_id_idx on public.profile_skills (skill_id, profile_id);

alter table public.profile_skills enable row level security;

revoke all on public.profile_skills from anon, authenticated;
grant select on public.profile_skills to authenticated;

create policy profile_skills_select on public.profile_skills
  for select to authenticated
  using (app.can_view_profile(profile_id));
