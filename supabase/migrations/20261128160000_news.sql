-- Novidades na página inicial (#307).
-- Quem publica: gestor com escopo sobre a unidade (vale para ela e para as de baixo). Quem lê: membro ativo cuja unidade é a
-- da novidade ou fica abaixo dela, ou seja, o próprio nível e os de cima. Texto puro (sem HTML), link só https com domínio,
-- validade opcional e arquivamento. Sem escrita direta: só as duas funções. O audit guarda quem e quando, nunca o texto.
-- O cartão da janela de transferência NÃO mora aqui: vem do estado da própria janela (house_transfer_window).

-- ---------------------------------------------------------------------------------------
-- 1. A tabela
-- ---------------------------------------------------------------------------------------
create table public.news (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80 and title !~ '[<>]'),
  body text not null check (char_length(body) between 1 and 280 and body !~ '[<>]'),
  -- Só https, com domínio de verdade (sem localhost, sem IP, sem usuário na frente).
  link text check (
    char_length(link) <= 300
    and link ~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:[0-9]{1,5})?(/[^[:space:]<>"]*)?$'
  ),
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null
);

comment on table public.news is
  'Novidades da página inicial (#307): título, texto curto e link https opcional, por unidade, vistas do nível para cima. Só `publish_news` e `archive_news` escrevem.';

create index news_unit_id_idx on public.news (unit_id);
create index news_published_by_idx on public.news (published_by);
create index news_archived_by_idx on public.news (archived_by);
create index news_published_at_idx on public.news (published_at desc) where archived_at is null;

-- ---------------------------------------------------------------------------------------
-- 2. Quem vê: membro ativo na unidade da novidade ou abaixo dela
-- ---------------------------------------------------------------------------------------
create or replace function app.sees_news_unit(p_unit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1
      from public.unit_members as m
      join public.units as mine on mine.id = m.unit_id
      join public.units as target on target.id = p_unit
      where m.profile_id = (select auth.uid())
        and m.left_at is null
        and mine.path operator(extensions.<@) target.path
    );
$$;

comment on function app.sees_news_unit(uuid) is
  'Membro ativo cujo vínculo aberto é a unidade dada ou uma abaixo dela (o próprio nível e os de cima).';

revoke execute on function app.sees_news_unit(uuid) from public, anon;
grant execute on function app.sees_news_unit(uuid) to authenticated;

alter table public.news enable row level security;

create policy news_select on public.news
  for select to authenticated
  using (
    archived_at is null
    and (expires_at is null or expires_at > now())
    and app.sees_news_unit(unit_id)
  );

-- Sem escrita direta. `published_by` fica fora da leitura (quem publicou está no audit_log).
revoke all on public.news from public, anon, authenticated;
grant select (id, unit_id, title, body, link, published_at, expires_at, archived_at) on public.news to authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Auditoria
-- ---------------------------------------------------------------------------------------
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
  'news_published', 'news_archived'
));

-- ---------------------------------------------------------------------------------------
-- 4. Publicar
-- ---------------------------------------------------------------------------------------
create or replace function public.publish_news(
  p_unit uuid, p_title text, p_body text, p_link text default null, p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  unit_path extensions.ltree;
  title_clean text := btrim(p_title);
  body_clean text := btrim(p_body);
  link_clean text := nullif(btrim(p_link), '');
  new_id uuid;
begin
  if caller is null then
    raise exception 'sem sessão' using errcode = 'insufficient_privilege';
  end if;
  select u.path into unit_path from public.units as u where u.id = p_unit and u.status = 'active';
  -- Unidade que não existe e unidade fora do escopo respondem igual: não revela a árvore.
  if unit_path is null or not app.has_scope_over(unit_path, array['manager']) then
    raise exception 'sem permissão para publicar nesta unidade' using errcode = 'insufficient_privilege';
  end if;
  if title_clean is null or char_length(title_clean) not between 1 and 80
     or body_clean is null or char_length(body_clean) not between 1 and 280
     or title_clean ~ '[<>]' or body_clean ~ '[<>]' then
    raise exception 'título ou texto inválido' using errcode = 'invalid_parameter_value';
  end if;
  if link_clean is not null and (
       char_length(link_clean) > 300
       or link_clean !~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:[0-9]{1,5})?(/[^[:space:]<>"]*)?$'
     ) then
    raise exception 'link inválido: só https com domínio' using errcode = 'invalid_parameter_value';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'a validade precisa estar no futuro' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.news (unit_id, title, body, link, published_by, expires_at)
  values (p_unit, title_clean, body_clean, link_clean, caller, p_expires_at)
  returning id into new_id;
  insert into public.audit_log (actor_id, event) values (caller, 'news_published');
  return new_id;
end;
$$;

comment on function public.publish_news(uuid, text, text, text, timestamptz) is
  'Gestor com escopo sobre a unidade publica uma novidade (texto puro, link https opcional, validade opcional); grava news_published sem o texto (#307).';

revoke execute on function public.publish_news(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.publish_news(uuid, text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. Arquivar
-- ---------------------------------------------------------------------------------------
-- Idempotente: arquivar de novo não muda nada nem grava de novo.
create or replace function public.archive_news(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  unit_path extensions.ltree;
  was_archived timestamptz;
begin
  if caller is null then
    raise exception 'sem sessão' using errcode = 'insufficient_privilege';
  end if;
  select u.path, n.archived_at into unit_path, was_archived
  from public.news as n join public.units as u on u.id = n.unit_id
  where n.id = p_id
  for update of n;
  if unit_path is null or not app.has_scope_over(unit_path, array['manager']) then
    raise exception 'sem permissão para arquivar esta novidade' using errcode = 'insufficient_privilege';
  end if;
  if was_archived is null then
    update public.news set archived_at = now(), archived_by = caller where id = p_id;
    insert into public.audit_log (actor_id, event) values (caller, 'news_archived');
  end if;
end;
$$;

comment on function public.archive_news(uuid) is
  'Gestor com escopo sobre a unidade arquiva a novidade (some da página inicial); grava news_archived (#307).';

revoke execute on function public.archive_news(uuid) from public, anon;
grant execute on function public.archive_news(uuid) to authenticated;
