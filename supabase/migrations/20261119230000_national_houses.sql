-- Casa nacional e coordenador de casa por território (issue #135, ADR 0011).
--
-- Substitui o modelo da #76 (uma unidade de casa dentro de cada região, coordenada pelo
-- `monitor` dessa unidade). Agora:
--
-- 1. `houses(key, active)`: a casa é nacional, fora da árvore de território. A chave é o `id` da
--    casa em `config/instance.ts` (minúsculas, números e hífens), e o nome e os textos ficam só
--    na config (R17): o banco não guarda o nome, para não haver duas fontes. O seed e a config
--    são conferidos juntos por tests/house-units.test.ts. `active = false` só impede novas
--    entradas; quem já está na casa continua nela.
-- 2. `house_members`: o vínculo de casa da pessoa, sem depender de região. Um aberto por
--    pessoa; `join_method`, `accepted_at`, `consent_version` (a versão do termo, só pelo
--    questionário) e `ended_by` (quem encerrou, gravado por trigger), com as regras da #76: sem
--    aceite o vínculo não conta, e o vínculo encerrado pela coordenação impede a volta sozinha.
-- 3. `role_assignments.role = 'house_coordinator'`, com `unit_id` (o território) e `house_key`
--    (obrigatória neste papel, nula nos outros). Vê as pessoas ATIVAS da casa, com vínculo de
--    casa aberto e aceito, cujo vínculo de território (`unit_members`) está em `unit_id` ou
--    abaixo. Vários por casa e por território. Concedido por um `manager` estritamente acima do
--    território (as regras do ADR 0002 para os outros papéis); ninguém concede a si mesmo.
--    NÃO entra em `app.my_scopes`: não tem escopo territorial (não gerencia unidade, não vê quem
--    é de outra casa, não decide acesso, não concede papel).
-- 4. Funções de acesso: `can_view_profile`, `can_view_contact` (pelas funções isoladas da #119),
--    `can_view_unit` e as políticas de `house_members` ganham o caminho "casa dentro do
--    território". `shares_open_house` e `is_house_coordinator_of` ganham o corpo novo.
-- 5. Sai o modelo antigo: o eixo `house` em `unit_types`/`unit_members` (`membership_axis`,
--    `axis`, `join_method`, `accepted_at`, `consent_version`, `app.membership_counts`), as
--    funções de região (`app.region_anchor`, `app.house_unit_for`) e o erro C7601 ("região não
--    definida"). `unit_members` volta a ser só território e equipe, com um vínculo aberto por
--    pessoa; `ended_by` fica (vale para qualquer vínculo).
-- 6. `audit_log.house_key`: a casa de `house_accepted` (o alvo passa a ser a pessoa).
--
-- Dados que já existam no modelo antigo (nada em produção; só por segurança em bancos de
-- desenvolvimento ou homologação): as casas viram linhas de `houses`; os vínculos de casa,
-- linhas de `house_members`; o monitor/manager ativo de uma unidade de casa vira
-- `house_coordinator` da casa no território pai da unidade. Depois, os vínculos e papéis nas
-- unidades de casa, as unidades e o tipo saem.
--
-- Códigos de erro de `accept_house` (o servidor traduz em mensagem):
--   P0002  casa inexistente ou inativa;
--   23505  outra casa já aceita;
--   C7602  a coordenação encerrou o vínculo de casa da pessoa (a volta é com ela).

-- ---------------------------------------------------------------------------------------
-- 1. houses
-- ---------------------------------------------------------------------------------------
create table public.houses (
  key text primary key
    constraint houses_key_format check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(key) <= 63),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.houses is
  'Casas de formação (ADR 0011), nacionais. A chave é o id da casa em config/instance.ts; nome e textos ficam só na config (R17).';

alter table public.houses enable row level security;

revoke all on public.houses from anon, authenticated;
grant select on public.houses to authenticated;

-- Só chaves e a situação, sem dado pessoal: quem está ativo lê. Escrita só por migration/seed.
create policy houses_select on public.houses
  for select to authenticated
  using (app.is_active_member());

-- ---------------------------------------------------------------------------------------
-- 2. house_members
-- ---------------------------------------------------------------------------------------
create table public.house_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  house_key text not null references public.houses (key) on delete restrict,
  join_method text not null
    constraint house_members_join_method_check check (join_method in ('self', 'questionnaire')),
  consent_version text references app.questionnaire_term_versions (version),
  joined_at timestamptz not null default now(),
  accepted_at timestamptz,
  left_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  constraint house_members_consent_version_only_questionnaire
    check ((consent_version is not null) = (join_method = 'questionnaire')),
  constraint house_members_accepted_after_joined
    check (accepted_at is null or accepted_at >= joined_at),
  constraint house_members_left_after_joined
    check (left_at is null or left_at >= joined_at)
);

comment on table public.house_members is
  'Vínculo de casa da pessoa (ADR 0011): um aberto por pessoa, sem depender de região. Sem aceite, não conta.';
comment on column public.house_members.join_method is
  'self (escolha direta) ou questionnaire (casa sugerida). Nunca as respostas.';
comment on column public.house_members.consent_version is
  'Pelo questionário: a versão do termo aceito. Nula em self.';
comment on column public.house_members.accepted_at is
  'Quando a pessoa aceitou. Sem aceite, o vínculo não conta para ninguém.';
comment on column public.house_members.ended_by is
  'Quem encerrou o vínculo (auth.uid() de quem gravou left_at; nulo: operação direta no banco ou conta excluída).';

create unique index house_members_one_open_per_profile
  on public.house_members (profile_id) where left_at is null;
create index house_members_house_open_idx
  on public.house_members (house_key) where left_at is null;

alter table public.house_members enable row level security;

-- Quem encerra é quem grava `left_at`; o valor enviado é ignorado. Aceita o nulo da cascata
-- (`on delete set null` de quem encerrou e excluiu a conta, #18).
create or replace function app.tg_house_members_set_ended_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.left_at is null then
    new.ended_by := null;
  elsif tg_op = 'INSERT' or old.left_at is null then
    new.ended_by := (select auth.uid());
  elsif new.ended_by is null
        and old.ended_by is not null
        and not exists (select 1 from public.profiles as p where p.id = old.ended_by) then
    new.ended_by := null;
  else
    new.ended_by := old.ended_by;
  end if;
  return new;
end;
$$;

create trigger house_members_set_ended_by
  before insert or update of left_at, ended_by on public.house_members
  for each row execute function app.tg_house_members_set_ended_by();

revoke execute on function app.tg_house_members_set_ended_by() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. role_assignments: house_coordinator
-- ---------------------------------------------------------------------------------------
alter table public.role_assignments
  drop constraint role_assignments_role_check,
  add constraint role_assignments_role_check
    check (role in ('monitor', 'manager', 'spokesperson', 'tech_admin', 'house_coordinator')),
  add column house_key text references public.houses (key) on delete restrict,
  add constraint role_assignments_house_key_only_house_coordinator
    check ((role = 'house_coordinator') = (house_key is not null));

comment on column public.role_assignments.house_key is
  'Só em house_coordinator (obrigatória): a casa coordenada dentro do território unit_id (ADR 0011).';

-- Um papel ativo por pessoa, papel, unidade e casa (a mesma pessoa pode coordenar duas casas
-- no mesmo território).
drop index public.role_assignments_one_active;
create unique index role_assignments_one_active
  on public.role_assignments (profile_id, role, unit_id, house_key) nulls not distinct
  where revoked_at is null;

grant insert (house_key) on public.role_assignments to authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Dados do modelo antigo (só se existirem)
-- ---------------------------------------------------------------------------------------
-- Casa antiga → chave: o slug da unidade com `-` no lugar de `_` (a ligação da #76).
insert into public.houses (key)
select distinct replace(u.slug, '_', '-')
from public.units as u
join public.unit_types as t on t.id = u.type_id
where t.membership_axis = 'house'
  and replace(u.slug, '_', '-') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
on conflict (key) do nothing;

-- O gatilho de `ended_by` usaria auth.uid() (nulo aqui); grava-se o valor antigo depois.
insert into public.house_members
  (profile_id, house_key, join_method, consent_version, joined_at, accepted_at, left_at)
select m.profile_id, replace(u.slug, '_', '-'), coalesce(m.join_method, 'self'),
       case when m.join_method = 'questionnaire' then m.consent_version end,
       m.joined_at, m.accepted_at, m.left_at
from public.unit_members as m
join public.units as u on u.id = m.unit_id
where m.axis = 'house'
  and replace(u.slug, '_', '-') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and exists (select 1 from public.profiles as p where p.id = m.profile_id);

alter table public.house_members disable trigger house_members_set_ended_by;
update public.house_members as h
set ended_by = m.ended_by
from public.unit_members as m
join public.units as u on u.id = m.unit_id
where m.axis = 'house'
  and m.profile_id = h.profile_id
  and m.left_at is not distinct from h.left_at
  and m.joined_at = h.joined_at
  and replace(u.slug, '_', '-') = h.house_key
  and m.ended_by is not null;
alter table public.house_members enable trigger house_members_set_ended_by;

-- Coordenação antiga (monitor/manager ativo numa unidade de casa) → coordenador da casa no
-- território pai.
insert into public.role_assignments (profile_id, role, unit_id, house_key, granted_by, granted_at)
select distinct on (r.profile_id, u.parent_id, replace(u.slug, '_', '-'))
       r.profile_id, 'house_coordinator', u.parent_id, replace(u.slug, '_', '-'),
       r.granted_by, r.granted_at
from public.role_assignments as r
join public.units as u on u.id = r.unit_id
join public.unit_types as t on t.id = u.type_id
where t.membership_axis = 'house'
  and r.revoked_at is null
  and r.role in ('monitor', 'manager')
  and u.parent_id is not null
  and replace(u.slug, '_', '-') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
order by r.profile_id, u.parent_id, replace(u.slug, '_', '-'), r.granted_at;

delete from public.role_assignments as r
using public.units as u, public.unit_types as t
where u.id = r.unit_id and t.id = u.type_id and t.membership_axis = 'house';

delete from public.unit_members as m
where m.axis = 'house';

delete from public.units as u
using public.unit_types as t
where t.id = u.type_id and t.membership_axis = 'house';

delete from public.unit_types where membership_axis = 'house';

-- ---------------------------------------------------------------------------------------
-- 5. Sai o eixo da casa em unit_types / unit_members
-- ---------------------------------------------------------------------------------------
-- As políticas deixam de citar `axis`/`membership_counts` antes de as colunas saírem
-- (mesmas regras de `..._active_member_guard.sql`).
alter policy unit_members_select on public.unit_members
  using (
    (profile_id = (select auth.uid()) and app.is_active_member())
    or (app.can_manage_unit(unit_id) and app.is_active_profile(profile_id))
  );

alter policy unit_members_update on public.unit_members
  using (
    left_at is null
    and app.can_manage_unit(unit_id)
    and app.is_active_profile(profile_id)
  )
  with check (app.can_manage_unit(unit_id) and app.is_active_profile(profile_id));

drop trigger unit_members_set_axis on public.unit_members;
drop trigger units_axis_locked on public.units;
drop trigger unit_types_axis_locked on public.unit_types;
drop function app.tg_unit_members_set_axis();
drop function app.tg_units_axis_locked();
drop function app.tg_unit_types_axis_locked();

drop index public.unit_members_one_open_per_axis;
create unique index unit_members_one_open_per_profile
  on public.unit_members (profile_id) where left_at is null;

alter table public.unit_members
  drop constraint unit_members_consent_version_only_questionnaire,
  drop constraint unit_members_house_only_fields,
  drop constraint unit_members_accepted_after_joined,
  drop column consent_version,
  drop column join_method,
  drop column accepted_at,
  drop column axis;

alter table public.unit_types
  drop constraint unit_types_is_team_axis,
  drop column membership_axis;

drop function app.house_unit_for(uuid, text);
drop function app.region_anchor(uuid);

-- ---------------------------------------------------------------------------------------
-- 6. Funções de acesso
-- ---------------------------------------------------------------------------------------
-- Entrada no estado: o vínculo de território é o único de `unit_members` (como na #46).
create or replace function app.tg_join_state_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_unit uuid;
  open_unit uuid;
  open_is_state boolean;
begin
  if new.state_code is null
     or (tg_op = 'UPDATE' and new.state_code is not distinct from old.state_code) then
    return null;
  end if;

  select u.id into state_unit
  from public.units as u
  where u.state_code = new.state_code and u.status = 'active';

  if state_unit is null then
    return null;
  end if;

  select m.unit_id, u.state_code is not null into open_unit, open_is_state
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  where m.profile_id = new.id and m.left_at is null;

  if open_unit = state_unit or (open_unit is not null and not open_is_state) then
    return null;
  end if;

  if open_unit is not null then
    update public.unit_members
    set left_at = now()
    where profile_id = new.id and left_at is null;
  end if;

  insert into public.unit_members (unit_id, profile_id) values (state_unit, new.id);
  return null;
end;
$$;

-- A casa aberta e aceita da pessoa (chave), ou nulo.
create or replace function app.open_house_of(person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select h.house_key
  from public.house_members as h
  where h.profile_id = person
    and h.left_at is null
    and h.accepted_at is not null;
$$;

comment on function app.open_house_of(uuid) is
  'A casa (chave) do vínculo aberto e aceito da pessoa, ou nulo. Interna (não chamável pela API).';

-- `viewer` tem papel `house_coordinator` ativo para a casa `house` num território igual ou
-- acima do vínculo aberto de território de `target`? Os dois precisam estar ativos (ADR 0008
-- §1). Não olha o vínculo de casa de `target`: quem chama decide se exige a casa aberta
-- (`is_house_coordinator_of`) ou se basta a casa da linha (histórico em `house_members`).
create or replace function app.coordinates_house_in_territory(viewer uuid, target uuid, house text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null and target is not null and house is not null
    and app.is_active_profile(viewer)
    and app.is_active_profile(target)
    and exists (
      select 1
      from public.role_assignments as r
      join public.units as ru on ru.id = r.unit_id
      join public.unit_members as m
        on m.profile_id = target
       and m.left_at is null
      join public.units as mu on mu.id = m.unit_id
      where r.profile_id = viewer
        and r.role = 'house_coordinator'
        and r.revoked_at is null
        and r.house_key = house
        and mu.path operator(extensions.<@) ru.path
    );
$$;

-- `viewer` coordena a casa de `target` (ADR 0011 §3)? `target` tem vínculo de casa aberto e
-- aceito na casa do papel, e o vínculo de território dele está no território do papel ou
-- abaixo. Os dois ativos. Corpo novo da função isolada pela #119.
create or replace function app.is_house_coordinator_of(viewer uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.coordinates_house_in_territory(viewer, target, app.open_house_of(target)),
    false
  );
$$;

-- Quem chama coordena o vínculo de casa `house` de `target`? A coordenação territorial
-- (monitor ou manager acima do vínculo de território de `target`, de qualquer casa; ADR 0011
-- §4) ou o coordenador da casa ABERTA de `target` no território, e só para essa casa (o
-- histórico de outra casa não aparece). Serve às políticas de `house_members`.
create or replace function app.can_manage_house_member(target uuid, house text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and app.is_active_profile(target)
    and (
      exists (
        select 1
        from public.unit_members as m
        join public.units as u on u.id = m.unit_id
        where m.profile_id = target
          and m.left_at is null
          and app.has_scope_over(u.path, array['monitor', 'manager'])
      )
      or (
        house = app.open_house_of(target)
        and app.is_house_coordinator_of((select auth.uid()), target)
      )
    );
$$;

comment on function app.can_manage_house_member(uuid, text) is
  'Coordenação territorial de target, ou coordenador da casa `house` no território de target (ADR 0011).';

create or replace function app.can_view_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      target = (select auth.uid())
      or (
        app.is_active_member()
        and app.is_active_profile(target)
        and (
          exists (
            select 1
            from public.unit_members as m
            join public.units as u on u.id = m.unit_id
            where m.profile_id = target
              and m.left_at is null
              and app.has_scope_over(u.path, array['monitor', 'manager', 'spokesperson'])
          )
          -- Casa dentro do território (ADR 0011).
          or app.is_house_coordinator_of((select auth.uid()), target)
        )
      )
    );
$$;

-- Unidades: o coordenador de casa vê o seu território (a estrutura abaixo e o caminho até a
-- raiz; nenhum dado pessoal), como os outros papéis.
create or replace function app.can_view_unit(target_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1
      from public.units as u
      where u.id = target_unit
        and (
          exists (
            select 1 from public.role_assignments as r
            where r.profile_id = (select auth.uid())
              and r.role = 'tech_admin'
              and r.revoked_at is null
          )
          or exists (
            select 1 from app.my_scopes() as s
            where u.path operator(extensions.<@) s.unit_path
               or u.path operator(extensions.@>) s.unit_path
          )
          or exists (
            select 1
            from public.role_assignments as r
            join public.units as ru on ru.id = r.unit_id
            where r.profile_id = (select auth.uid())
              and r.role = 'house_coordinator'
              and r.revoked_at is null
              and (u.path operator(extensions.<@) ru.path
                   or u.path operator(extensions.@>) ru.path)
          )
          or exists (
            select 1
            from public.unit_members as m
            join public.units as mu on mu.id = m.unit_id
            where m.profile_id = (select auth.uid())
              and m.left_at is null
              and u.path operator(extensions.@>) mu.path
          )
        )
    );
$$;

create or replace function app.manages_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and target is not null
    and target <> (select auth.uid())
    and (
      exists (
        select 1
        from public.unit_members as m
        join public.units as u on u.id = m.unit_id
        where m.profile_id = target
          and m.left_at is null
          and app.has_scope_over(u.path, array['manager'])
      )
      or (
        not exists (
          select 1 from public.unit_members as m
          where m.profile_id = target and m.left_at is null
        )
        and app.manages_root()
      )
    );
$$;

-- Conceder: `house_coordinator` segue a regra de monitor/manager/spokesperson (ADR 0011 §5):
-- só um manager ativo, em unidade estritamente abaixo da sua, nunca a si mesmo. Exceção: na
-- raiz, o manager ativo da raiz concede o coordenador nacional de casa (e só esse papel). A
-- casa (`house_key`) é conferida pela política de INSERT (`app.is_open_house`).
create or replace function app.can_grant_role(role text, target_unit uuid, grantee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and app.is_active_member()
    and grantee is not null
    and grantee <> (select auth.uid())
    and (
      (
        can_grant_role.role in ('monitor', 'manager', 'spokesperson', 'house_coordinator')
        and exists (
          select 1
          from public.units as u
          join app.my_scopes() as s
            on u.path operator(extensions.<@) s.unit_path
           and u.path operator(extensions.<>) s.unit_path
          where u.id = target_unit
            and s.role = 'manager'
        )
      )
      or (
        can_grant_role.role = 'manager'
        and exists (
          select 1 from public.units as u
          where u.id = target_unit and u.parent_id is null
        )
        and exists (
          select 1 from public.role_assignments as r
          where r.profile_id = (select auth.uid())
            and r.role = 'tech_admin'
            and r.revoked_at is null
        )
        and not exists (
          select 1 from public.role_assignments as r
          where r.unit_id = target_unit
            and r.role = 'manager'
            and r.revoked_at is null
        )
      )
      -- Exceção aprovada (PR #141): o coordenador NACIONAL de casa (na raiz) é concedido pelo
      -- manager ativo da própria raiz, que não tem ninguém acima. Só este papel, só na raiz.
      or (
        can_grant_role.role = 'house_coordinator'
        and exists (
          select 1 from public.units as u
          where u.id = target_unit and u.parent_id is null
        )
        and app.manages_root()
      )
    );
$$;

-- A casa existe e aceita entradas (novas pessoas ou novos coordenadores)?
create or replace function app.is_open_house(house text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.houses as h where h.key = house and h.active);
$$;

alter policy role_assignments_insert on public.role_assignments
  with check (
    granted_by = (select auth.uid())
    and revoked_at is null
    and app.can_grant_role(role, unit_id, profile_id)
    and (house_key is null or app.is_open_house(house_key))
  );

-- --- Contato (ADR 0010): só o corpo das funções isoladas pela #119 muda -----------------
create or replace function app.shares_open_team(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null and b is not null and a <> b
    and exists (
      select 1
      from public.unit_members as ma
      join public.unit_members as mb
        on mb.unit_id = ma.unit_id
       and mb.profile_id = b
       and mb.left_at is null
      join public.units as u on u.id = ma.unit_id
      join public.unit_types as t on t.id = u.type_id
      where ma.profile_id = a
        and ma.left_at is null
        and u.status = 'active'
        and t.is_team
    );
$$;

create or replace function app.home_territory(person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when t.is_team then u.parent_id else u.id end
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  join public.unit_types as t on t.id = u.type_id
  where m.profile_id = person
    and m.left_at is null;
$$;

-- "Minha casa" (ADR 0010): a mesma casa nacional, os dois vínculos abertos e aceitos há pelo
-- menos 7 dias, e o mesmo território mais próximo (não nulo).
create or replace function app.shares_open_house(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null and b is not null and a <> b
    and coalesce(app.home_territory(a) = app.home_territory(b), false)
    and exists (
      select 1
      from public.house_members as ha
      join public.house_members as hb
        on hb.house_key = ha.house_key
       and hb.profile_id = b
       and hb.left_at is null
       and hb.accepted_at <= now() - interval '7 days'
      where ha.profile_id = a
        and ha.left_at is null
        and ha.accepted_at <= now() - interval '7 days'
    );
$$;

-- `can_view_contact(target, kind)`: só o eixo de território sai da condição (agora é o único
-- de `unit_members`); a casa continua por `is_house_coordinator_of`.
create or replace function app.can_view_contact(target uuid, kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target is not null
    and coalesce(kind in ('whatsapp', 'social', 'email'), false)
    and (
      target = (select auth.uid())
      or (
        app.is_active_member()
        and app.is_active_profile(target)
        and (
          -- Coordenação do escopo (ADR 0002 e 0010): pelo território...
          exists (
            select 1
            from public.unit_members as m
            join public.units as u on u.id = m.unit_id
            where m.profile_id = target
              and m.left_at is null
              and app.has_scope_over(u.path, array['monitor', 'manager'])
          )
          -- ... ou o coordenador da casa do alvo, dentro do seu território (ADR 0011).
          or app.is_house_coordinator_of((select auth.uid()), target)
          -- Colega, se a pessoa autorizou (ADR 0010).
          or app.shares_contact_group(target, app.contact_visibility_of(target, kind))
        )
      )
    );
$$;

revoke execute on function
  app.open_house_of(uuid),
  app.coordinates_house_in_territory(uuid, uuid, text),
  app.can_manage_house_member(uuid, text),
  app.is_open_house(text)
from public, anon;

-- Recebem pessoas explícitas: chamadas soltas revelariam a casa de alguém ou quem coordena
-- quem (como as auxiliares da #119).
revoke execute on function
  app.open_house_of(uuid),
  app.coordinates_house_in_territory(uuid, uuid, text)
from authenticated;

grant execute on function
  app.can_manage_house_member(uuid, text),
  app.is_open_house(text)
to authenticated;

drop function app.membership_counts(text, timestamptz);

-- ---------------------------------------------------------------------------------------
-- house_members: grants e políticas
-- ---------------------------------------------------------------------------------------
-- Escrever é só por `accept_house`; a coordenação só encerra (`left_at`).
revoke all on public.house_members from anon, authenticated;
grant select on public.house_members to authenticated;
grant update (left_at) on public.house_members to authenticated;

-- A pessoa vê os próprios vínculos (inclusive sem aceite); a coordenação vê só os aceitos, de
-- perfis ativos, no seu escopo.
create policy house_members_select on public.house_members
  for select to authenticated
  using (
    (profile_id = (select auth.uid()) and app.is_active_member())
    or (accepted_at is not null and app.can_manage_house_member(profile_id, house_key))
  );

-- A coordenação encerra um vínculo aberto e aceito; um vínculo encerrado não reabre.
create policy house_members_update on public.house_members
  for update to authenticated
  using (
    left_at is null
    and accepted_at is not null
    and app.can_manage_house_member(profile_id, house_key)
  )
  with check (
    left_at is not null
    and app.can_manage_house_member(profile_id, house_key)
  );

-- ---------------------------------------------------------------------------------------
-- 7. audit_log: a casa de house_accepted
-- ---------------------------------------------------------------------------------------
-- `house_accepted` passa a ter alvo = a pessoa e `house_key` = a casa. Os registros antigos
-- (alvo = unidade de casa, sem `house_key`) ficam como estão (só-inserção); por isso a regra
-- entra como NOT VALID: vale para toda linha nova.
alter table public.audit_log
  add column house_key text
    constraint audit_log_house_key_format check (house_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table public.audit_log
  add constraint audit_log_house_key_by_event check (
    case
      when event = 'house_accepted' then house_key is not null and target_id = actor_id
      else house_key is null
    end
  ) not valid;

-- ---------------------------------------------------------------------------------------
-- 8. accept_house
-- ---------------------------------------------------------------------------------------
-- Escolha e aceite da casa, de uma vez (#76), sem depender de região (ADR 0011):
-- - só quem chama, liberado e ativo, conferido depois de travar o perfil;
-- - `questionnaire` exige o aceite de exatamente `term_version` (gravada no vínculo); em
--   `self`, a versão é ignorada;
-- - a casa precisa existir e estar ativa (P0002);
-- - com uma casa já aceita: a mesma casa devolve o mesmo vínculo; outra é recusada (23505);
-- - vínculo de casa encerrado por outra pessoa (coordenação ou operação) impede voltar
--   sozinho, na mesma casa ou em outra (C7602);
-- - um vínculo aberto ainda sem aceite é encerrado (pela própria pessoa) e dá lugar ao novo.
-- Registra `house_accepted` (alvo = a pessoa). Devolve o id do vínculo.
create or replace function public.accept_house(p_house_key text, p_join_method text, p_term_version text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  consent_ver text;
  open_id uuid;
  open_house text;
  open_accepted timestamptz;
  new_id uuid;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  -- Trava o perfil antes de conferir o status: uma suspensão simultânea não passa, e dois
  -- cliques não criam dois vínculos (o índice também barra).
  perform 1 from public.profiles as p where p.id = caller for update;
  if not app.is_active_member() then
    raise exception 'só quem está ativo escolhe a casa' using errcode = 'insufficient_privilege';
  end if;

  if p_join_method is null or p_join_method not in ('self', 'questionnaire') then
    raise exception 'forma de entrada inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_join_method = 'questionnaire' then
    if not exists (
      select 1 from public.questionnaire_consents as c
      where c.profile_id = caller and c.term_version = p_term_version
    ) then
      raise exception 'o questionário exige o termo desta versão aceito'
        using errcode = 'invalid_parameter_value';
    end if;
    consent_ver := p_term_version;
  end if;

  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  select h.id, h.house_key, h.accepted_at into open_id, open_house, open_accepted
  from public.house_members as h
  where h.profile_id = caller and h.left_at is null;

  if open_accepted is not null then
    if open_house = p_house_key then
      return open_id;
    end if;
    raise exception 'a casa já foi aceita' using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from public.house_members as h
    where h.profile_id = caller
      and h.left_at is not null
      and h.ended_by is distinct from caller
  ) then
    raise exception 'a coordenação encerrou a sua casa; a volta é com ela' using errcode = 'C7602';
  end if;

  if open_id is not null then
    update public.house_members set left_at = now() where id = open_id;
  end if;

  insert into public.house_members (profile_id, house_key, join_method, accepted_at, consent_version)
  values (caller, p_house_key, p_join_method, now(), consent_ver)
  returning id into new_id;

  insert into public.audit_log (actor_id, event, target_id, reason, term_version, house_key)
  values (caller, 'house_accepted', caller, p_join_method, consent_ver, p_house_key);
  return new_id;
end;
$$;

comment on function public.accept_house(text, text, text) is
  'Quem chama aceita a casa nacional `house_key` (id da config); guarda a forma e a versão do termo (ADR 0011).';
