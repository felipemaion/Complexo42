-- Casa de formação como segundo eixo de vínculo (issue #76, ADR 0008 §2).
--
-- 1. `unit_types.membership_axis` (`team` ou `house`): o eixo do vínculo de quem entra numa
--    unidade daquele tipo. `team` é o eixo territorial (estado, região, equipe); `house` é a
--    casa de formação. Vem do seed da instância; não muda depois que o tipo tem vínculos.
-- 2. `unit_members.axis`: cópia do eixo do tipo da unidade, gravada por trigger (o valor
--    enviado é ignorado). Fica na linha porque o índice único parcial precisa dela: um índice
--    não consulta outra tabela. Os triggers de 1 e de `units.type_id` impedem que a cópia
--    fique diferente do tipo.
-- 3. Índice único parcial: um vínculo aberto por pessoa **e por eixo** (uma casa e uma
--    equipe ao mesmo tempo). Substitui o "um vínculo aberto por pessoa" da #46.
-- 4. `join_method` (`self`, `questionnaire`) e `accepted_at`, só no eixo `house`. **Sem
--    aceite, o vínculo de casa não conta**: não dá visão a quem coordena a casa, não mostra a
--    unidade à pessoa e não aparece para terceiros. A regra está em `app.membership_counts`
--    e entra em todas as funções e políticas que leem `unit_members`.
-- 5. `tg_join_state_unit` passa a olhar só o eixo `team` (a casa não atrapalha a entrada no
--    estado, e a entrada no estado não encerra a casa).
--
-- As funções de escolha da casa e o registro do termo do questionário ficam em
-- `..._house_selection.sql`.

-- ---------------------------------------------------------------------------------------
-- 1. unit_types.membership_axis
-- ---------------------------------------------------------------------------------------
alter table public.unit_types
  add column membership_axis text not null default 'team'
    constraint unit_types_membership_axis_check check (membership_axis in ('team', 'house'));

comment on column public.unit_types.membership_axis is
  'Eixo do vínculo (ADR 0008 §2): team (território e equipe) ou house (casa de formação).';

-- O eixo não muda depois que alguma unidade do tipo tem vínculo (aberto ou histórico): as
-- linhas de unit_members guardam o eixo e ficariam diferentes do tipo.
create or replace function app.tg_unit_types_axis_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.membership_axis is distinct from old.membership_axis
     and exists (
       select 1
       from public.unit_members as m
       join public.units as u on u.id = m.unit_id
       where u.type_id = old.id
     ) then
    raise exception 'o eixo de um tipo com vínculos não muda'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger unit_types_axis_locked
  before update of membership_axis on public.unit_types
  for each row execute function app.tg_unit_types_axis_locked();

-- Trocar o tipo de uma unidade com vínculos só vale para um tipo do mesmo eixo.
create or replace function app.tg_units_axis_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type_id is distinct from old.type_id
     and (select t.membership_axis from public.unit_types as t where t.id = new.type_id)
         is distinct from
         (select t.membership_axis from public.unit_types as t where t.id = old.type_id)
     and exists (select 1 from public.unit_members as m where m.unit_id = old.id) then
    raise exception 'uma unidade com vínculos não muda de eixo'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger units_axis_locked
  before update of type_id on public.units
  for each row execute function app.tg_units_axis_locked();

-- ---------------------------------------------------------------------------------------
-- 2 a 4. unit_members: eixo, forma de entrada e aceite
-- ---------------------------------------------------------------------------------------
alter table public.unit_members
  add column axis text not null default 'team'
    constraint unit_members_axis_check check (axis in ('team', 'house')),
  add column join_method text
    constraint unit_members_join_method_check check (join_method in ('self', 'questionnaire')),
  add column accepted_at timestamptz,
  -- Forma de entrada e aceite só existem no eixo da casa.
  add constraint unit_members_house_only_fields
    check (axis = 'house' or (join_method is null and accepted_at is null)),
  add constraint unit_members_accepted_after_joined
    check (accepted_at is null or accepted_at >= joined_at);

comment on column public.unit_members.axis is
  'Eixo do tipo da unidade, gravado pelo trigger (o valor enviado é ignorado).';
comment on column public.unit_members.join_method is
  'Casa: self (escolha direta) ou questionnaire (casa sugerida). Nunca as respostas.';
comment on column public.unit_members.accepted_at is
  'Casa: quando a pessoa aceitou. Sem aceite, o vínculo não conta (app.membership_counts).';

create or replace function app.tg_unit_members_set_axis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select t.membership_axis into new.axis
  from public.units as u
  join public.unit_types as t on t.id = u.type_id
  where u.id = new.unit_id;
  return new;
end;
$$;

create trigger unit_members_set_axis
  before insert or update of unit_id, axis on public.unit_members
  for each row execute function app.tg_unit_members_set_axis();

-- As linhas que já existem: o eixo do tipo atual de cada unidade.
update public.unit_members as m
set axis = t.membership_axis
from public.units as u
join public.unit_types as t on t.id = u.type_id
where u.id = m.unit_id;

drop index public.unit_members_one_open_per_profile;
create unique index unit_members_one_open_per_axis
  on public.unit_members (profile_id, axis) where left_at is null;

revoke execute on function
  app.tg_unit_types_axis_locked(),
  app.tg_units_axis_locked(),
  app.tg_unit_members_set_axis()
from public, anon, authenticated;

-- O vínculo conta para escopo e visibilidade? Equipe sempre; casa só depois do aceite.
create or replace function app.membership_counts(axis text, accepted_at timestamptz)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select axis = 'team' or accepted_at is not null;
$$;

comment on function app.membership_counts(text, timestamptz) is
  'Vínculo que conta: equipe sempre; casa só com accepted_at (ADR 0008 §2).';

revoke execute on function app.membership_counts(text, timestamptz) from public, anon;
grant execute on function app.membership_counts(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Funções de acesso: o vínculo de casa sem aceite não conta
-- (mesmas definições de `..._active_member_guard.sql` e `..._access_allowlist.sql`, com a
-- condição `app.membership_counts` em cada leitura de unit_members)
-- ---------------------------------------------------------------------------------------
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
        and exists (
          select 1
          from public.unit_members as m
          join public.units as u on u.id = m.unit_id
          where m.profile_id = target
            and m.left_at is null
            and app.membership_counts(m.axis, m.accepted_at)
            and app.has_scope_over(u.path, array['monitor', 'manager', 'spokesperson'])
        )
      )
    );
$$;

create or replace function app.can_view_contact(target uuid)
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
        and exists (
          select 1
          from public.unit_members as m
          join public.units as u on u.id = m.unit_id
          where m.profile_id = target
            and m.left_at is null
            and app.membership_counts(m.axis, m.accepted_at)
            and app.has_scope_over(u.path, array['monitor', 'manager'])
        )
      )
    );
$$;

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
            from public.unit_members as m
            join public.units as mu on mu.id = m.unit_id
            where m.profile_id = (select auth.uid())
              and m.left_at is null
              and app.membership_counts(m.axis, m.accepted_at)
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
          and app.membership_counts(m.axis, m.accepted_at)
          and app.has_scope_over(u.path, array['manager'])
      )
      or (
        not exists (
          select 1 from public.unit_members as m
          where m.profile_id = target
            and m.left_at is null
            and app.membership_counts(m.axis, m.accepted_at)
        )
        and app.manages_root()
      )
    );
$$;

-- Vínculos: a pessoa vê os próprios (inclusive a casa ainda sem aceite); quem gerencia a
-- unidade vê e mantém só os que contam, de perfis ativos.
alter policy unit_members_select on public.unit_members
  using (
    (profile_id = (select auth.uid()) and app.is_active_member())
    or (
      app.membership_counts(axis, accepted_at)
      and app.can_manage_unit(unit_id)
      and app.is_active_profile(profile_id)
    )
  );

alter policy unit_members_update on public.unit_members
  using (
    left_at is null
    and app.membership_counts(axis, accepted_at)
    and app.can_manage_unit(unit_id)
    and app.is_active_profile(profile_id)
  )
  with check (app.can_manage_unit(unit_id) and app.is_active_profile(profile_id));

-- ---------------------------------------------------------------------------------------
-- 5. Entrada no estado: só o eixo `team`
-- ---------------------------------------------------------------------------------------
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
  where m.profile_id = new.id and m.left_at is null and m.axis = 'team';

  if open_unit = state_unit or (open_unit is not null and not open_is_state) then
    return null;
  end if;

  if open_unit is not null then
    update public.unit_members
    set left_at = now()
    where profile_id = new.id and left_at is null and axis = 'team';
  end if;

  insert into public.unit_members (unit_id, profile_id) values (state_unit, new.id);
  return null;
end;
$$;
