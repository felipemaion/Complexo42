-- Quem chama também precisa estar liberado (issue #10, revisão do PR #112; ADR 0008 §1).
-- Até aqui as funções conferiam só o status do ALVO: um monitor ou manager em `waitlisted`,
-- `blocked` ou `suspended` continuava com todo o escopo. Agora:
--
-- - `app.is_active_member()`: quem chama tem perfil com `access_status = 'active'` e
--   `status = 'active'`. Sem isso não há escopo (my_scopes, has_scope_over), não se vê
--   perfil, contato nem unidade de terceiros, não se concede nem revoga papel, e não se lê
--   unit_types, units, unit_members nem role_assignments.
-- - `app.is_active_profile(target)`: o alvo está liberado e ativo. Só esses aparecem para
--   terceiros (perfil, contato e vínculo), e só os vínculos deles são alterados pelo gestor.
-- - `app.can_read_municipalities()`: quem ainda vai se cadastrar (sem perfil) ou está
--   `pending`/`active` lê municípios (precisa escolher o seu); `waitlisted`/`blocked` não.
-- - Quem está em `waitlisted` ou `blocked` lê só o próprio perfil (e o próprio contato).
-- - `suspended` (status da conta): ninguém vê o perfil, e o titular lê, mas não edita.

-- ---------------------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------------------
create or replace function app.is_active_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles as p
    where p.id = target and p.access_status = 'active' and p.status = 'active'
  );
$$;

comment on function app.is_active_profile(uuid) is
  'O perfil está liberado pela lista (access_status) e com a conta ativa (status).';

create or replace function app.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_profile((select auth.uid()));
$$;

comment on function app.is_active_member() is
  'Quem chama está liberado e ativo. Sem isso, não tem escopo nem lê a estrutura (ADR 0008 §1).';

create or replace function app.can_read_municipalities()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and not exists (
      select 1 from public.profiles as p
      where p.id = (select auth.uid()) and p.access_status in ('waitlisted', 'blocked')
    );
$$;

-- ---------------------------------------------------------------------------------------
-- Funções de acesso (mesmas regras, agora com a guarda de quem chama)
-- ---------------------------------------------------------------------------------------
create or replace function app.my_scopes()
returns table (unit_id uuid, unit_path extensions.ltree, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.unit_id, u.path, r.role
  from public.role_assignments as r
  join public.units as u on u.id = r.unit_id
  where r.profile_id = (select auth.uid())
    and r.revoked_at is null
    and r.role in ('monitor', 'manager', 'spokesperson')
    and app.is_active_member();
$$;

create or replace function app.has_scope_over(target_path extensions.ltree, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1
      from app.my_scopes() as s
      where s.role = any (roles)
        and target_path operator(extensions.<@) s.unit_path
    );
$$;

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
            and app.has_scope_over(u.path, array['monitor', 'manager'])
        )
      )
    );
$$;

-- Titular, e não `blocked` nem `suspended`. `pending` e `waitlisted` editam o próprio
-- perfil (precisam completar o cadastro); sem perfil ainda, pode criá-lo.
create or replace function app.can_edit_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target = (select auth.uid())
    and not exists (
      select 1 from public.profiles as p
      where p.id = target and (p.access_status = 'blocked' or p.status = 'suspended')
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
              and u.path operator(extensions.@>) mu.path
          )
        )
    );
$$;

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
        can_grant_role.role in ('monitor', 'manager', 'spokesperson')
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
    );
$$;

create or replace function app.can_revoke_role(target_unit uuid, granter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and app.is_active_member()
    and (
      granter = (select auth.uid())
      or exists (
        select 1
        from public.units as u
        join app.my_scopes() as s
          on u.path operator(extensions.<@) s.unit_path
         and u.path operator(extensions.<>) s.unit_path
        where u.id = target_unit
          and s.role = 'manager'
      )
    );
$$;

revoke execute on function
  app.is_active_profile(uuid),
  app.is_active_member(),
  app.can_read_municipalities()
from public, anon;

grant execute on function
  app.is_active_profile(uuid),
  app.is_active_member(),
  app.can_read_municipalities()
to authenticated;

-- ---------------------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------------------
alter policy municipalities_select on public.municipalities
  using (app.can_read_municipalities());

alter policy unit_types_select on public.unit_types
  using (app.is_active_member());

-- units_select (can_view_unit) e units_update (can_manage_unit → my_scopes) já passam
-- pela guarda nas funções.

-- A pessoa vê os próprios vínculos se estiver ativa; o gestor vê e mantém só os vínculos de
-- perfis ativos.
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

alter policy role_assignments_select on public.role_assignments
  using (
    app.is_active_member()
    and (
      profile_id = (select auth.uid())
      or granted_by = (select auth.uid())
      or app.can_manage_unit(unit_id)
    )
  );
