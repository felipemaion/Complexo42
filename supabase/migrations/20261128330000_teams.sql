-- Equipes (#28 e #29, ADR 0007 §2, ADR 0002): criar equipe, adicionar e remover membros, definir o líder e arquivar. A equipe
-- é uma `unit` do tipo `team` (sem entidade nova). A API continua SEM INSERT/UPDATE direto em `units` e `unit_members`:
-- tudo passa por estas funções (security definer, search_path vazio), que conferem o escopo de quem chama
-- (`app.can_manage_unit`) e gravam `member_moved` com ator, alvo e as duas unidades, sem nome. O UPDATE direto em
-- `unit_members` (papel no grupo e encerramento) também sai da API (seção 0): nenhuma tela o usava, e por ele dava para
-- criar dois líderes ou encerrar um vínculo sem `member_moved`.
-- Uma pessoa tem UM vínculo aberto por vez (`unit_members_one_open_per_profile`): entrar numa equipe encerra o anterior
-- (o da unidade do estado ou o de outra equipe); sair da equipe devolve a pessoa à unidade do estado dela.

-- 0. Sem UPDATE direto em `unit_members`: papel e encerramento só pelas funções abaixo (`set_team_lead`, `remove_team_member`).
revoke update (member_role, left_at) on public.unit_members from authenticated;
drop policy unit_members_update on public.unit_members;

-- 1. `member_moved` passa a guardar de onde e para onde (ids de unidade, sem FK: o registro sobrevive).
alter table public.audit_log
  add column from_unit_id uuid,
  add column to_unit_id uuid,
  add constraint audit_log_units_only_for_moves
    check ((from_unit_id is null and to_unit_id is null) or event = 'member_moved');

comment on column public.audit_log.from_unit_id is 'member_moved: a unidade do vínculo encerrado (nulo se não havia).';
comment on column public.audit_log.to_unit_id is 'member_moved: a unidade do vínculo novo (nulo se a pessoa ficou sem unidade).';

-- 2. Rótulo (`slug`) da equipe a partir do nome: minúsculo, sem acento, só a-z, 0-9 e _; se já existe no pai, sufixo _2, _3...
create or replace function app.team_slug(p_name text, p_parent uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n integer := 1;
begin
  base := regexp_replace(app.norm_text(p_name), '[^a-z0-9]+', '_', 'g');
  base := btrim(base, '_');
  base := left(base, 40);
  base := btrim(base, '_');
  if base = '' then
    base := 'equipe';
  end if;
  candidate := base;
  while exists (select 1 from public.units as u where u.parent_id = p_parent and u.slug = candidate) loop
    n := n + 1;
    candidate := base || '_' || n::text;
    if n > 200 then
      raise exception 'não foi possível gerar um rótulo único' using errcode = 'unique_violation';
    end if;
  end loop;
  return candidate;
end;
$$;

revoke execute on function app.team_slug(text, uuid) from public, anon, authenticated;

-- 3. Criar equipe: quem gerencia a unidade-pai (monitor ou gestor ali ou acima). Devolve o id da equipe.
create or replace function public.create_team(p_parent uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  clean text := btrim(p_name);
  team_type uuid;
  parent_ok boolean;
  new_id uuid;
begin
  if caller is null or p_parent is null or not app.is_active_member() or not app.can_manage_unit(p_parent) then
    raise exception 'sem permissão para criar equipe aqui' using errcode = 'insufficient_privilege';
  end if;
  if clean is null or char_length(clean) not between 2 and 80 or clean ~ '[[:cntrl:]­​-‏‪-‮⁠-⁤⁦-⁩﻿]' then
    raise exception 'nome de equipe inválido' using errcode = 'invalid_parameter_value';
  end if;
  select t.id into team_type from public.unit_types as t where t.is_team;
  select u.status = 'active' and not t.is_team into parent_ok
  from public.units as u join public.unit_types as t on t.id = u.type_id where u.id = p_parent;
  if team_type is null or parent_ok is not true then
    raise exception 'unidade-pai inválida' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from public.units as u where u.id = p_parent for update;
  insert into public.units (type_id, parent_id, slug, name, path)
  values (team_type, p_parent, app.team_slug(clean, p_parent), clean, 'x'::extensions.ltree)
  returning id into new_id;
  return new_id;
end;
$$;

comment on function public.create_team(uuid, text) is
  'Cria uma equipe (unidade do tipo team) abaixo de uma unidade que quem chama gerencia (#28).';

-- 4. Adicionar pessoas à equipe, uma resposta por id (adicionada ou recusada, sem dizer o motivo). Recusa: a própria
--    pessoa que chama, quem não passa em `can_view_profile`, quem tem vínculo numa unidade de origem (equipe ou não) que quem chama NÃO gerencia, e (com
--    `p_max`) o que passaria do teto de membros. Quem já está na equipe conta como adicionada, sem gravar nada.
create or replace function public.add_team_members(p_team uuid, p_profiles uuid[], p_max integer default null)
returns table (profile_id uuid, added boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller uuid := (select auth.uid());
  pid uuid;
  current_unit uuid;
  open_count integer;
begin
  if caller is null or p_team is null or not app.is_active_member() or not app.can_manage_unit(p_team) then
    raise exception 'sem permissão para mexer nesta equipe' using errcode = 'insufficient_privilege';
  end if;
  -- Trava a equipe ANTES de conferir se está ativa: sem isso, um `archive_team` concorrente passa entre a checagem e a trava.
  perform 1 from public.units as u where u.id = p_team for update;
  if not exists (
    select 1 from public.units as u join public.unit_types as t on t.id = u.type_id
    where u.id = p_team and t.is_team and u.status = 'active'
  ) then
    raise exception 'equipe inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_profiles is null or cardinality(p_profiles) > 200 or (p_max is not null and p_max < 1) then
    raise exception 'lista de pessoas inválida' using errcode = 'invalid_parameter_value';
  end if;

  for pid in select distinct x from unnest(p_profiles) as x where x is not null order by x loop
    profile_id := pid;
    added := false;
    perform 1 from public.profiles as p where p.id = pid for update;

    if pid <> caller and app.can_view_profile(pid) then
      current_unit := null;
      select m.unit_id into current_unit
      from public.unit_members as m
      where m.profile_id = pid and m.left_at is null;

      if current_unit = p_team then
        added := true;
      elsif current_unit is null or app.can_manage_unit(current_unit) then
        select count(*) into open_count from public.unit_members as m where m.unit_id = p_team and m.left_at is null;
        if p_max is null or open_count < p_max then
          update public.unit_members as m set left_at = now() where m.profile_id = pid and m.left_at is null;
          insert into public.unit_members (unit_id, profile_id) values (p_team, pid);
          insert into public.audit_log (actor_id, event, target_id, from_unit_id, to_unit_id)
          values (caller, 'member_moved', pid, current_unit, p_team);
          added := true;
        end if;
      end if;
    end if;
    return next;
  end loop;
end;
$$;

comment on function public.add_team_members(uuid, uuid[], integer) is
  'Põe pessoas na equipe (encerra o vínculo anterior). Resposta parcial por id, sem o motivo da recusa (#28).';

-- 5. Tirar uma pessoa da equipe: encerra o vínculo e a devolve à unidade do estado dela (se houver). true se estava na equipe.
create or replace function public.remove_team_member(p_team uuid, p_profile uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  state_unit uuid;
begin
  if caller is null or p_team is null or p_profile is null or not app.is_active_member() or not app.can_manage_unit(p_team) then
    raise exception 'sem permissão para mexer nesta equipe' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.units as u where u.id = p_team for update;
  if not exists (
    select 1 from public.units as u join public.unit_types as t on t.id = u.type_id
    where u.id = p_team and t.is_team and u.status = 'active'
  ) then
    raise exception 'equipe inválida' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from public.profiles as p where p.id = p_profile for update;
  if not exists (select 1 from public.unit_members as m where m.unit_id = p_team and m.profile_id = p_profile and m.left_at is null) then
    return false;
  end if;
  update public.unit_members as m set left_at = now() where m.unit_id = p_team and m.profile_id = p_profile and m.left_at is null;
  select u.id into state_unit
  from public.profiles as p
  join public.units as u on u.state_code = p.state_code and u.status = 'active'
  where p.id = p_profile;
  if state_unit is not null then
    insert into public.unit_members (unit_id, profile_id) values (state_unit, p_profile);
  end if;
  insert into public.audit_log (actor_id, event, target_id, from_unit_id, to_unit_id)
  values (caller, 'member_moved', p_profile, p_team, state_unit);
  return true;
end;
$$;

comment on function public.remove_team_member(uuid, uuid) is
  'Tira a pessoa da equipe e a devolve à unidade do estado dela (#28).';

-- 6. Líder da equipe (#29): um só, membro vigente. `p_profile` nulo tira o líder (ninguém fica como líder).
create or replace function public.set_team_lead(p_team uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or p_team is null or not app.is_active_member() or not app.can_manage_unit(p_team) then
    raise exception 'sem permissão para mexer nesta equipe' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.units as u where u.id = p_team for update;
  if not exists (
    select 1 from public.units as u join public.unit_types as t on t.id = u.type_id
    where u.id = p_team and t.is_team and u.status = 'active'
  ) then
    raise exception 'equipe inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_profile is not null and not exists (
    select 1 from public.unit_members as m where m.unit_id = p_team and m.profile_id = p_profile and m.left_at is null
  ) then
    raise exception 'a pessoa não está na equipe' using errcode = 'no_data_found';
  end if;
  update public.unit_members as m set member_role = 'member' where m.unit_id = p_team and m.left_at is null and m.member_role <> 'member';
  if p_profile is not null then
    update public.unit_members as m set member_role = 'lead' where m.unit_id = p_team and m.profile_id = p_profile and m.left_at is null;
  end if;
end;
$$;

comment on function public.set_team_lead(uuid, uuid) is 'Define (ou tira) o líder da equipe: um só, membro vigente (#29).';

-- 7. Arquivar equipe: só vazia (sem vínculo aberto). Arquivada, deixa de ser "equipe" para o contato (ADR 0010).
create or replace function public.archive_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or p_team is null or not app.is_active_member() or not app.can_manage_unit(p_team) then
    raise exception 'sem permissão para mexer nesta equipe' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.units as u where u.id = p_team for update;
  if not exists (
    select 1 from public.units as u join public.unit_types as t on t.id = u.type_id
    where u.id = p_team and t.is_team and u.status = 'active'
  ) then
    raise exception 'equipe inválida' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.unit_members as m where m.unit_id = p_team and m.left_at is null) then
    raise exception 'a equipe ainda tem membros' using errcode = 'invalid_parameter_value';
  end if;
  update public.units set status = 'archived' where id = p_team;
end;
$$;

comment on function public.archive_team(uuid) is 'Arquiva uma equipe vazia (#28). Equipe com membros: 22023.';

revoke execute on function
  public.create_team(uuid, text),
  public.add_team_members(uuid, uuid[], integer),
  public.remove_team_member(uuid, uuid),
  public.set_team_lead(uuid, uuid),
  public.archive_team(uuid)
from public, anon;
grant execute on function
  public.create_team(uuid, text),
  public.add_team_members(uuid, uuid[], integer),
  public.remove_team_member(uuid, uuid),
  public.set_team_lead(uuid, uuid),
  public.archive_team(uuid)
to authenticated;
