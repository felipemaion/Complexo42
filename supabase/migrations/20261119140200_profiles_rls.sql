-- Funções de acesso, grants e políticas RLS de `profiles` e `profile_contacts` (issue #10).
-- Toda decisão passa pelas funções `app.can_*` (R15); os testes estão em
-- supabase/tests/profiles.test.sql e supabase/tests/permissions_matrix.test.sql (R16).
--
-- | Quem                       | Lê perfil             | Lê contato       | Cria/edita            |
-- |----------------------------|-----------------------|------------------|-----------------------|
-- | o titular                  | sim (qualquer status) | sim              | sim, se não `blocked` |
-- | monitor/manager do escopo  | sim, se `active`      | sim, se `active` | não                   |
-- | spokesperson do escopo     | sim, se `active`      | não              | não                   |
-- | tech_admin, fora do escopo | não                   | não              | não                   |
--
-- O titular nunca altera `id`, `state_code` (vem do município), `status`, `access_status`
-- (definido pelo servidor, #26), `consent_at`, `created_at` nem `updated_at`: essas colunas
-- não têm grant de INSERT/UPDATE. Nada é apagado pela API: excluir a conta é um fluxo próprio
-- (apaga `auth.users`, e o perfil vai junto em cascata).

-- ---------------------------------------------------------------------------------------
-- Funções de acesso
-- ---------------------------------------------------------------------------------------
-- O perfil de terceiros só aparece se estiver `active` (ADR 0008 §1: quem está na espera,
-- pendente ou bloqueado não aparece em busca nem em painel). O próprio, sempre.
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
        exists (
          select 1 from public.profiles as p
          where p.id = target and p.access_status = 'active'
        )
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

-- Contato: o próprio, ou monitor/manager do escopo, e só de perfil `active`. O servidor
-- registra `contact_viewed` no audit_log a cada visualização (ADR 0002, regra 6).
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
        exists (
          select 1 from public.profiles as p
          where p.id = target and p.access_status = 'active'
        )
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

-- Pode criar ou editar o perfil e o contato de `target`? Só o titular, e não se o perfil
-- estiver bloqueado (ADR 0008 §1). Gestor e monitor não editam dado pessoal de ninguém.
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
      where p.id = target and p.access_status = 'blocked'
    );
$$;

revoke execute on function app.can_edit_profile(uuid) from public, anon;
grant execute on function app.can_edit_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Grants: fechado por padrão, reaberto coluna a coluna
-- ---------------------------------------------------------------------------------------
revoke all on public.profiles, public.profile_contacts from anon, authenticated;

grant select on public.profiles to authenticated;
grant insert (id, display_name_enc, municipality_code, district, consent_version)
  on public.profiles to authenticated;
grant update (display_name_enc, municipality_code, district, consent_version)
  on public.profiles to authenticated;

grant select on public.profile_contacts to authenticated;
grant insert (profile_id, whatsapp_enc, whatsapp_hmac, social_links_enc)
  on public.profile_contacts to authenticated;
grant update (whatsapp_enc, whatsapp_hmac, social_links_enc)
  on public.profile_contacts to authenticated;

-- ---------------------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (app.can_view_profile(id));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (app.can_edit_profile(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (app.can_edit_profile(id))
  with check (app.can_edit_profile(id));

create policy profile_contacts_select on public.profile_contacts
  for select to authenticated
  using (app.can_view_contact(profile_id));

create policy profile_contacts_insert on public.profile_contacts
  for insert to authenticated
  with check (app.can_edit_profile(profile_id));

create policy profile_contacts_update on public.profile_contacts
  for update to authenticated
  using (app.can_edit_profile(profile_id))
  with check (app.can_edit_profile(profile_id));
