-- Hierarquia genérica de unidades (issue #46, ADR 0005 §2).
-- 1. Extensão ltree no schema `extensions`.
-- 2. Tabelas `unit_types`, `units`, `unit_members` e `role_assignments`, todas com RLS.
--    As políticas e os grants ficam na migration `..._hierarchy_rls.sql`; até lá, com RLS
--    ligada e sem política, ninguém além do dono lê nada.
-- 3. Triggers que mantêm `units.path` a partir de `parent_id` (inclusive ao mover um ramo).
--
-- Sem `organization_id`: uma instância por uso (ADR 0005 §1).
-- Ainda não existe `profiles` (#10). A "pessoa" é `auth.users(id)`, que será também o
-- `profiles.id` (docs/MODELO_DADOS.md). Quando `profiles` existir, as colunas `profile_id`
-- continuam apontando para o mesmo id.

-- ---------------------------------------------------------------------------------------
-- ltree
-- ---------------------------------------------------------------------------------------
-- O servidor (deploy/initdb/01-extensions.sql) cria a extensão sem schema, ou seja, em
-- `public`; o Supabase local usa `extensions`. Para as funções poderem qualificar tudo
-- (`search_path = ''`) com um nome só, a extensão sempre termina em `extensions`.
-- ltree é relocável, e neste ponto nada depende dela.
create schema if not exists extensions;
create extension if not exists ltree with schema extensions;

do $$
begin
  if (select n.nspname
      from pg_catalog.pg_extension as e
      join pg_catalog.pg_namespace as n on n.oid = e.extnamespace
      where e.extname = 'ltree') <> 'extensions' then
    alter extension ltree set schema extensions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- unit_types: configuração da instância (rótulos e níveis), vem do seed
-- ---------------------------------------------------------------------------------------
create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  label text not null check (length(label) between 1 and 60),
  level smallint not null check (level >= 0),
  created_at timestamptz not null default now()
);

comment on table public.unit_types is
  'Tipos de unidade da instância (ADR 0005). A interface usa `label`, nunca um nome fixo (R17).';
comment on column public.unit_types.level is
  'Profundidade: 0 é a raiz. Uma unidade só fica abaixo de outra de nível menor.';

alter table public.unit_types enable row level security;

-- ---------------------------------------------------------------------------------------
-- units: a árvore
-- ---------------------------------------------------------------------------------------
create table public.units (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.unit_types (id),
  parent_id uuid references public.units (id) on delete restrict,
  -- Rótulo do nó no `path` (ex.: `sp`, `abc`, `equipe_7`).
  slug text not null check (slug ~ '^[a-z0-9_]{1,63}$'),
  name text not null check (length(name) between 1 and 120),
  -- Mantido por trigger a partir de `parent_id` e `slug`; o valor enviado é ignorado.
  path extensions.ltree not null,
  -- Marca a unidade que recebe quem se cadastra naquele estado (ADR 0005 §2).
  state_code char(2) check (state_code ~ '^[A-Z]{2}$'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  constraint units_parent_slug_key unique (parent_id, slug),
  constraint units_not_own_parent check (parent_id is distinct from id)
);

comment on table public.units is
  'Árvore de unidades (ADR 0005). Quem tem papel em U enxerga U e tudo abaixo (path <@ U.path).';

create index units_path_gist on public.units using gist (path);
create unique index units_path_key on public.units (path);
create index units_parent_id_idx on public.units (parent_id);
create index units_type_id_idx on public.units (type_id);
-- Uma única raiz por instância.
create unique index units_single_root on public.units ((true)) where parent_id is null;
-- Uma unidade de entrada por estado.
create unique index units_state_code_key on public.units (state_code)
  where state_code is not null;

alter table public.units enable row level security;

-- Antes de gravar: calcula `path`, valida o nível do tipo e impede ciclos.
create or replace function app.tg_units_set_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_path extensions.ltree;
  parent_level smallint;
  own_level smallint;
begin
  -- Chamado pela cascata de `tg_units_cascade_path`, que já calculou o `path` do ramo.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- O CHECK da coluna só roda depois deste trigger, e a conversão para ltree falharia antes.
  if new.slug !~ '^[a-z0-9_]{1,63}$' then
    raise exception 'slug inválido: use de 1 a 63 caracteres entre a-z, 0-9 e _'
      using errcode = 'check_violation';
  end if;

  select t.level into own_level from public.unit_types as t where t.id = new.type_id;

  if new.parent_id is null then
    if own_level <> 0 then
      raise exception 'a raiz precisa ser de um tipo de nível 0'
        using errcode = 'check_violation';
    end if;
    new.path := new.slug::extensions.ltree;
    return new;
  end if;

  select u.path, t.level into parent_path, parent_level
  from public.units as u
  join public.unit_types as t on t.id = u.type_id
  where u.id = new.parent_id;

  if own_level <= parent_level then
    raise exception 'o tipo da unidade precisa ter nível maior que o do pai'
      using errcode = 'check_violation';
  end if;

  -- Mover um ramo para dentro dele mesmo criaria um ciclo.
  if tg_op = 'UPDATE' and parent_path operator(extensions.<@) old.path then
    raise exception 'uma unidade não pode ficar abaixo de si mesma'
      using errcode = 'check_violation';
  end if;

  new.path := parent_path operator(extensions.||) new.slug::extensions.ltree;
  return new;
end;
$$;

create trigger units_set_path
  before insert or update of parent_id, slug, path, type_id on public.units
  for each row execute function app.tg_units_set_path();

-- Depois de mover ou renomear: reescreve o `path` de todo o ramo abaixo.
create or replace function app.tg_units_cascade_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.path operator(extensions.<>) old.path then
    update public.units as u
    set path = new.path operator(extensions.||)
      extensions.subpath(u.path, extensions.nlevel(old.path))
    where u.path operator(extensions.<@) old.path
      and u.id <> new.id;
  end if;
  return null;
end;
$$;

-- Só no UPDATE feito pelo cliente ou pela migration (profundidade 0): a própria cascata
-- não dispara outra cascata.
create trigger units_cascade_path
  after update of parent_id, slug, path, type_id on public.units
  for each row
  when (pg_trigger_depth() = 0)
  execute function app.tg_units_cascade_path();

revoke execute on function app.tg_units_set_path() from public;
revoke execute on function app.tg_units_cascade_path() from public;

-- ---------------------------------------------------------------------------------------
-- unit_members: vínculo de uma pessoa com uma unidade (histórico, nunca apagado)
-- ---------------------------------------------------------------------------------------
create table public.unit_members (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete restrict,
  profile_id uuid not null references auth.users (id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('lead', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  constraint unit_members_left_after_joined check (left_at is null or left_at >= joined_at)
);

comment on table public.unit_members is
  'Vínculos com unidades. Sair encerra o vínculo (left_at), não apaga (ADR 0007 §2).';
comment on column public.unit_members.profile_id is
  'auth.users.id, que será profiles.id (#10).';

-- Um vínculo aberto por pessoa. A #76 troca por "um por pessoa e por eixo" (ADR 0008 §2).
create unique index unit_members_one_open_per_profile
  on public.unit_members (profile_id) where left_at is null;
create index unit_members_unit_open_idx
  on public.unit_members (unit_id) where left_at is null;

alter table public.unit_members enable row level security;

-- ---------------------------------------------------------------------------------------
-- role_assignments: papéis com escopo (ADR 0002 + 0005)
-- ---------------------------------------------------------------------------------------
create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('monitor', 'manager', 'spokesperson', 'tech_admin')),
  unit_id uuid not null references public.units (id) on delete restrict,
  -- Nulo só no seed e na criação do primeiro admin técnico (fora da API).
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint role_assignments_revoked_after_granted
    check (revoked_at is null or revoked_at >= granted_at)
);

comment on table public.role_assignments is
  'Papéis com escopo: valem na unidade e em todas abaixo dela (ADR 0005 §2).';

create unique index role_assignments_one_active
  on public.role_assignments (profile_id, role, unit_id) where revoked_at is null;
create index role_assignments_profile_active_idx
  on public.role_assignments (profile_id) where revoked_at is null;
create index role_assignments_unit_idx on public.role_assignments (unit_id);

alter table public.role_assignments enable row level security;
