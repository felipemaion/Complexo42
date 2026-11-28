-- Gestão do catálogo de habilidades pela coordenação nacional (#25).
--
-- `skills` continua só de leitura pela API: toda escrita passa por estas funções, que só a coordenação
-- nacional (`app.manages_root()`) chama. Cada mudança grava um evento no audit_log (só ator, sem dado pessoal).
--
-- * Renomear mantém o id: quem tem a habilidade continua com ela. O nome antigo vira sinônimo, para a busca
--   ainda achá-la.
-- * Desativar tira a habilidade da busca e da escolha de quem ainda não a tem; quem já a marcou mantém.
-- * Mesclar A em B troca A por B nos perfis (quem já tem B só perde A), passa o nome e os sinônimos de A para B e
--   desativa A. Numa transação, com trava nas duas linhas.
-- * Grupo é a coluna `category`. Renomear um grupo é operação própria (`rename_skill_group`), nunca efeito de
--   renomear uma habilidade. Esta migration não semeia grupos nem move habilidades.
--
-- Erros: 42501 sem permissão; 22023 dado inválido; P0002 não achou; C7704 nome já existe; C7705 mesclagem inválida.

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked',
  'house_analysis_requested', 'house_analysis_resolved',
  'questionnaire_access_granted', 'questionnaire_access_revoked',
  'questionnaire_result_viewed', 'house_changed',
  'house_window_opened', 'house_window_closed',
  'skill_suggestion_decided', 'skill_reactivated',
  'skills_searched',
  'skill_created', 'skill_renamed', 'skill_moved', 'skill_deactivated', 'skill_merged', 'skill_group_renamed'
));

-- Quem chama precisa ser a coordenação nacional.
create or replace function app.require_skill_admin()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not app.manages_root() then
    raise exception 'só a coordenação nacional gere o catálogo' using errcode = 'insufficient_privilege';
  end if;
  return caller;
end;
$$;

revoke execute on function app.require_skill_admin() from public, anon;
grant execute on function app.require_skill_admin() to authenticated;

-- Cria uma habilidade. Nome igual (sem caixa e sem acento) a outra, mesmo desativada: C7704 (reative a existente).
create or replace function public.create_skill(p_name text, p_category text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.require_skill_admin();
  nm text := btrim(p_name);
  cat text := btrim(p_category);
  new_id uuid;
begin
  if not app.valid_skill_name(nm) or not app.valid_skill_name(cat) then
    raise exception 'nome ou grupo inválido' using errcode = 'invalid_parameter_value';
  end if;
  begin
    insert into public.skills (name, category) values (nm, cat) returning id into new_id;
  exception when unique_violation then
    raise exception 'essa habilidade já existe' using errcode = 'C7704';
  end;
  insert into public.audit_log (actor_id, event) values (caller, 'skill_created');
  return new_id;
end;
$$;

-- Renomeia (o id e quem a tem não mudam). O nome antigo entra nos sinônimos.
create or replace function public.rename_skill(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.require_skill_admin();
  nm text := btrim(p_name);
  old public.skills;
begin
  if not app.valid_skill_name(nm) then
    raise exception 'nome inválido' using errcode = 'invalid_parameter_value';
  end if;
  select * into old from public.skills as s where s.id = p_id for update;
  if not found then
    raise exception 'habilidade não encontrada' using errcode = 'no_data_found';
  end if;
  if old.name = nm then
    return;
  end if;
  begin
    update public.skills set name = nm, aliases = aliases || app.norm_text(old.name) where id = p_id;
  exception when unique_violation then
    raise exception 'essa habilidade já existe' using errcode = 'C7704';
  end;
  insert into public.audit_log (actor_id, event) values (caller, 'skill_renamed');
end;
$$;

-- Move uma habilidade para outro grupo (existente ou novo).
create or replace function public.move_skill(p_id uuid, p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.require_skill_admin();
  cat text := btrim(p_category);
begin
  if not app.valid_skill_name(cat) then
    raise exception 'grupo inválido' using errcode = 'invalid_parameter_value';
  end if;
  update public.skills set category = cat where id = p_id and category <> cat;
  if not found then
    if not exists (select 1 from public.skills where id = p_id) then
      raise exception 'habilidade não encontrada' using errcode = 'no_data_found';
    end if;
    return;
  end if;
  insert into public.audit_log (actor_id, event) values (caller, 'skill_moved');
end;
$$;

-- Renomeia um grupo inteiro: operação explícita, à parte do renomear habilidade. Se o nome novo já é de outro
-- grupo, os dois viram um só.
create or replace function public.rename_skill_group(p_old text, p_new text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.require_skill_admin();
  old_cat text := btrim(p_old);
  new_cat text := btrim(p_new);
  moved integer;
begin
  if not app.valid_skill_name(old_cat) or not app.valid_skill_name(new_cat) then
    raise exception 'grupo inválido' using errcode = 'invalid_parameter_value';
  end if;
  if old_cat = new_cat then
    return 0;
  end if;
  update public.skills set category = new_cat where category = old_cat;
  get diagnostics moved = row_count;
  if moved = 0 then
    raise exception 'grupo não encontrado' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor_id, event) values (caller, 'skill_group_renamed');
  return moved;
end;
$$;

-- Ativa ou desativa. Desativada some da busca e da escolha; quem já a marcou mantém.
create or replace function public.set_skill_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.require_skill_admin();
begin
  if p_active is null then
    raise exception 'valor inválido' using errcode = 'invalid_parameter_value';
  end if;
  update public.skills set active = p_active where id = p_id and active <> p_active;
  if not found then
    if not exists (select 1 from public.skills where id = p_id) then
      raise exception 'habilidade não encontrada' using errcode = 'no_data_found';
    end if;
    return;
  end if;
  insert into public.audit_log (actor_id, event)
  values (caller, case when p_active then 'skill_reactivated' else 'skill_deactivated' end);
end;
$$;

-- Mescla a duplicada `p_from` na que fica, `p_to`. A que fica precisa estar ativa. Devolve quantas pessoas
-- passaram a ter `p_to`. Trava as duas linhas em ordem de id: duas mesclagens ao mesmo tempo não se cruzam.
create or replace function public.merge_skills(p_from uuid, p_to uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.require_skill_admin();
  src public.skills;
  dst public.skills;
  moved integer;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'mesclagem inválida' using errcode = 'C7705';
  end if;
  perform 1 from public.skills as s where s.id in (p_from, p_to) order by s.id for update;
  select * into src from public.skills as s where s.id = p_from;
  select * into dst from public.skills as s where s.id = p_to;
  if src.id is null or dst.id is null then
    raise exception 'habilidade não encontrada' using errcode = 'no_data_found';
  end if;
  if not dst.active then
    raise exception 'a habilidade que fica precisa estar ativa' using errcode = 'C7705';
  end if;

  -- Troca de lugar sem passar pelo limite de 10: a pessoa continua com o mesmo número ou com um a menos.
  update public.profile_skills as ps set skill_id = p_to
  where ps.skill_id = p_from
    and not exists (select 1 from public.profile_skills as o where o.profile_id = ps.profile_id and o.skill_id = p_to);
  get diagnostics moved = row_count;
  delete from public.profile_skills where skill_id = p_from;

  update public.skills set aliases = aliases || src.aliases || app.norm_text(src.name) where id = p_to;
  update public.skills set active = false where id = p_from;

  insert into public.audit_log (actor_id, event) values (caller, 'skill_merged');
  return moved;
end;
$$;

revoke execute on function public.create_skill(text, text) from public, anon;
revoke execute on function public.rename_skill(uuid, text) from public, anon;
revoke execute on function public.move_skill(uuid, text) from public, anon;
revoke execute on function public.rename_skill_group(text, text) from public, anon;
revoke execute on function public.set_skill_active(uuid, boolean) from public, anon;
revoke execute on function public.merge_skills(uuid, uuid) from public, anon;
grant execute on function public.create_skill(text, text) to authenticated;
grant execute on function public.rename_skill(uuid, text) to authenticated;
grant execute on function public.move_skill(uuid, text) to authenticated;
grant execute on function public.rename_skill_group(text, text) to authenticated;
grant execute on function public.set_skill_active(uuid, boolean) to authenticated;
grant execute on function public.merge_skills(uuid, uuid) to authenticated;

comment on function public.merge_skills(uuid, uuid) is
  'A coordenação nacional mescla a habilidade duplicada na que fica: troca nos perfis, passa nome e sinônimos, desativa a antiga; audita (#25).';
