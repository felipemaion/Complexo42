-- Portfólio por links (#70, ADR 0007 §5, MODELO_DADOS): até 3 links de algo que a pessoa fez,
-- com título e tipo. O link vai cifrado pelo app (url_enc, ADR 0003: pode identificar a pessoa).
-- A plataforma não guarda arquivo. Dado da pessoa: some junto com a conta (cascade).

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,
  url_enc text not null check (app.is_encrypted_value(url_enc, 600)),
  kind text not null check (kind in ('video', 'image', 'text', 'other')),
  title text not null check (length(title) between 1 and 80),
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  unique (profile_id, position)
);

alter table public.portfolio_items enable row level security;

-- Leitura direta só da própria linha; o resto passa pelas funções abaixo. Sem escrita direta.
create policy portfolio_items_select_own on public.portfolio_items
  for select to authenticated using (profile_id = (select auth.uid()));

create or replace function public.add_portfolio_item(p_url_enc text, p_kind text, p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_title text := trim(coalesce(p_title, ''));
  v_count integer;
  v_id uuid;
begin
  if me is null or not app.is_active_member() then
    raise exception 'só membros ativos têm portfólio' using errcode = '42501';
  end if;
  if p_url_enc is null or not app.is_encrypted_value(p_url_enc, 600) then
    raise exception 'o link precisa vir cifrado' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('video', 'image', 'text', 'other') then
    raise exception 'tipo de item desconhecido' using errcode = '22023';
  end if;
  if length(v_title) not between 1 and 80 then
    raise exception 'o título tem de 1 a 80 letras' using errcode = '22023';
  end if;

  -- Trava a lista da pessoa para dois cliques seguidos não passarem de 3.
  perform 1 from public.portfolio_items where profile_id = me for update;
  select count(*) into v_count from public.portfolio_items where profile_id = me;
  if v_count >= 3 then
    raise exception 'o portfólio tem até 3 itens' using errcode = '22023';
  end if;

  insert into public.portfolio_items (profile_id, url_enc, kind, title, position)
  values (me, p_url_enc, p_kind, v_title, v_count + 1)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_portfolio_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_position smallint;
begin
  delete from public.portfolio_items where id = p_item and profile_id = me returning position into v_position;
  if v_position is null then
    raise exception 'só a dona ou o dono tira itens do próprio portfólio' using errcode = '42501';
  end if;
  -- Os de baixo sobem uma posição (sem buracos).
  update public.portfolio_items set position = position - 1 where profile_id = me and position > v_position;
end;
$$;

-- Itens de uma pessoa, para quem pode ver o perfil dela (ela mesma ou o escopo).
create or replace function public.portfolio_list(p_profile uuid)
returns table (id uuid, url_enc text, kind text, title text, "position" smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.url_enc, i.kind, i.title, i.position
  from public.portfolio_items as i
  where i.profile_id = p_profile and app.is_active_member() and app.can_view_profile(p_profile)
  order by i.position
$$;

revoke all on function public.add_portfolio_item(text, text, text), public.remove_portfolio_item(uuid), public.portfolio_list(uuid)
  from public, anon;
grant execute on function public.add_portfolio_item(text, text, text), public.remove_portfolio_item(uuid), public.portfolio_list(uuid)
  to authenticated;
revoke all on public.portfolio_items from public, anon, authenticated;
grant select on public.portfolio_items to authenticated;
