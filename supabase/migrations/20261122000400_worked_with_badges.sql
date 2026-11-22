-- Medalha "trabalhou com" (#71, ADR 0007 §3): cada porta-voz tem a SUA, criada sozinha quando a
-- pessoa vira porta-voz de uma equipe, e só ele a concede, a quem teve vínculo na equipe dele no
-- mesmo período em que ele era porta-voz. Ninguém concede a si mesmo. O nome do porta-voz não vai
-- em texto (é dado pessoal cifrado): a medalha se chama "Trabalhou com" e a tela junta o nome,
-- decifrado no servidor, a partir de quem a criou (created_by).

create unique index badges_worked_with_one_per_spokesperson
  on public.badges (created_by, scope_unit_id) where rule_type = 'worked_with';

create or replace function app.ensure_worked_with_badge(p_spokesperson uuid, p_team uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.badges (scope_unit_id, created_by, name, description, icon, rule_type)
  select p_team, p_spokesperson, 'Trabalhou com', '', 'coracao', 'worked_with'
  where p_spokesperson is not null and p_team is not null
  on conflict (created_by, scope_unit_id) where rule_type = 'worked_with' do nothing;
$$;

create or replace function app.trg_worked_with_on_spokesperson()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'spokesperson' and new.revoked_at is null then
    perform app.ensure_worked_with_badge(new.profile_id, new.unit_id);
  end if;
  return new;
end;
$$;

create trigger role_assignments_worked_with
  after insert on public.role_assignments
  for each row execute function app.trg_worked_with_on_spokesperson();

-- Quem já é porta-voz ganha a sua agora.
select app.ensure_worked_with_badge(r.profile_id, r.unit_id)
from public.role_assignments as r
where r.role = 'spokesperson' and r.revoked_at is null;

-- A medalha "trabalhou com" que quem chama pode dar nesta equipe (é ou foi porta-voz dela), ou null.
create or replace function public.my_worked_with_badge(p_team uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id from public.badges as b
  where b.rule_type = 'worked_with' and b.scope_unit_id = p_team and b.created_by = (select auth.uid())
    and app.is_active_member()
$$;

create or replace function public.grant_worked_with(p_profile uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Trabalhou na equipe');
  v_badge uuid;
  v_award uuid;
begin
  if me is null or not app.is_active_member() then
    raise exception 'só membros ativos concedem medalhas' using errcode = '42501';
  end if;
  if p_profile is null or p_profile = me then
    raise exception 'ninguém concede medalha a si mesmo' using errcode = '42501';
  end if;
  if not app.is_active_profile(p_profile) then
    raise exception 'só a quem está com o acesso liberado' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 300 then
    raise exception 'o motivo tem de 3 a 300 letras' using errcode = '22023';
  end if;

  -- A medalha de quem chama numa equipe em que a pessoa teve vínculo enquanto ele era porta-voz.
  select b.id into v_badge
  from public.badges as b
  join public.role_assignments as r
    on r.profile_id = me and r.unit_id = b.scope_unit_id and r.role = 'spokesperson'
  join public.unit_members as m
    on m.profile_id = p_profile and m.unit_id = b.scope_unit_id
  where b.rule_type = 'worked_with' and b.created_by = me
    and r.granted_at <= coalesce(m.left_at, now())
    and (r.revoked_at is null or r.revoked_at >= m.joined_at)
  limit 1;
  if v_badge is null then
    raise exception 'só a quem esteve na sua equipe' using errcode = '42501';
  end if;

  begin
    insert into public.profile_badges (profile_id, badge_id, awarded_by, reason)
    values (p_profile, v_badge, me, v_reason)
    returning id into v_award;
  exception when unique_violation then
    raise exception 'já concedida' using errcode = '23505';
  end;
  -- Mesmo registro da concessão manual (badge_granted), para a revogação ter de onde partir.
  insert into public.audit_log (actor_id, event, target_id) values (me, 'badge_granted', v_award);
  return v_award;
end;
$$;

revoke all on function app.ensure_worked_with_badge(uuid, uuid), app.trg_worked_with_on_spokesperson() from public, anon, authenticated;
revoke all on function public.my_worked_with_badge(uuid), public.grant_worked_with(uuid, text) from public, anon;
grant execute on function public.my_worked_with_badge(uuid), public.grant_worked_with(uuid, text) to authenticated;

-- A concessão manual não dá a medalha "trabalhou com" de ninguém (mesma função de
-- 20261121000400_badges, com essa recusa a mais).
create or replace function public.grant_badge(
  p_badge uuid,
  p_profile uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_unit_id uuid;
  v_unit_path extensions.ltree;
  v_reason text;
  v_award_id uuid;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem conceder medalhas' using errcode = '42501';
  end if;

  -- Regra: ninguém concede medalha a si mesmo (ADR 0007 §3)
  if p_profile = auth.uid() then
    raise exception 'Não é permitido conceder medalha a si mesmo' using errcode = '42501';
  end if;

  v_reason := trim(p_reason);
  if length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Motivo da concessão deve ter entre 3 e 300 caracteres' using errcode = '22023';
  end if;

  if not app.is_active_profile(p_profile) or not app.can_view_profile(p_profile) then
    raise exception 'Perfil alvo inválido ou sem visibilidade' using errcode = '42501';
  end if;

  select scope_unit_id into v_scope_unit_id
  from public.badges
  where id = p_badge;

  if v_scope_unit_id is null then
    raise exception 'Medalha não encontrada' using errcode = '42501';
  end if;

  -- "Trabalhou com" (#71): só o porta-voz dono dá, por public.grant_worked_with.
  if exists (select 1 from public.badges where id = p_badge and rule_type = 'worked_with') then
    raise exception 'a medalha "trabalhou com" só o porta-voz dono concede' using errcode = '42501';
  end if;

  select path into v_unit_path
  from public.units
  where id = v_scope_unit_id;

  if v_unit_path is null or not app.has_scope_over(v_unit_path, array['manager', 'monitor']) then
    raise exception 'Sem permissão de escopo para conceder esta medalha' using errcode = '42501';
  end if;

  insert into public.profile_badges (
    profile_id,
    badge_id,
    awarded_by,
    reason
  ) values (
    p_profile,
    p_badge,
    auth.uid(),
    v_reason
  )
  returning id into v_award_id;

  insert into public.audit_log (
    actor_id,
    event,
    target_id
  ) values (
    auth.uid(),
    'badge_granted',
    v_award_id
  );

  return v_award_id;
end;
$$;

-- A lista de medalhas da pessoa leva, na "trabalhou com", quem é o porta-voz e o nome dele cifrado
-- (mesma função de 20261121000400_badges, com as duas colunas a mais; muda o tipo de retorno).
drop function public.profile_badge_list(uuid);
create or replace function public.profile_badge_list(p_profile uuid)
returns table (
  award_id uuid,
  name text,
  description text,
  icon text,
  reason text,
  awarded_at timestamptz,
  owner_id uuid,
  owner_name_enc text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (p_profile = auth.uid() or app.can_view_profile(p_profile)) then
    return;
  end if;

  return query
  select
    pb.id as award_id,
    b.name,
    b.description,
    b.icon,
    pb.reason,
    pb.awarded_at,
    case when b.rule_type = 'worked_with' then b.created_by end as owner_id,
    -- O nome só sai enquanto o porta-voz está com o acesso liberado.
    case when b.rule_type = 'worked_with' and app.is_active_profile(b.created_by) then owner.display_name_enc end as owner_name_enc
  from public.profile_badges pb
  join public.badges b on b.id = pb.badge_id
  left join public.profiles owner on owner.id = b.created_by
  where pb.profile_id = p_profile
    and pb.revoked_at is null
  order by pb.awarded_at desc;
end;
$$;

revoke all on function public.profile_badge_list(uuid) from public, anon;
grant execute on function public.profile_badge_list(uuid) to authenticated;
