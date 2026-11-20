-- supabase/migrations/20261121000600_team_messages.sql
-- Ata de 17/11 §8 e Issue #120 (Conversa da equipe dentro da plataforma)

-- ============================================================================
-- 1. Tabelas e Estrutura de Dados
-- ============================================================================

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  author_id uuid not null references auth.users(id) on delete cascade,
  body_enc text not null check (app.is_encrypted_value(body_enc, 6000)),
  created_at timestamptz not null default now()
);

-- Índice para paginação cronológica reversa por equipe
create index idx_team_messages_unit_created
  on public.team_messages (unit_id, created_at desc);

-- ============================================================================
-- 2. Permissões e RLS (Row Level Security)
-- ============================================================================

alter table public.team_messages enable row level security;

revoke all on table public.team_messages from anon, authenticated;

grant select on table public.team_messages to authenticated;

-- Leitura de mensagens: membro ativo que tenha vínculo aberto na unidade ou permissão de gestão
create policy team_messages_select on public.team_messages
  for select to authenticated
  using (
    app.is_active_member()
    and (
      exists (
        select 1
        from public.unit_members um
        where um.unit_id = team_messages.unit_id
          and um.profile_id = auth.uid()
          and um.left_at is null
      )
      or app.can_manage_unit(unit_id)
    )
  );

-- ============================================================================
-- 3. Funções da API Pública (Security Definer)
-- ============================================================================

-- Envio de mensagem na equipe
create or replace function public.post_team_message(
  p_team uuid,
  p_body_enc text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_count integer;
  v_message_id uuid;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem enviar mensagens' using errcode = '42501';
  end if;

  -- Validação da unidade: tipo equipe (is_team), ativa e usuário com vínculo aberto nela
  if not exists (
    select 1
    from public.units u
    join public.unit_types ut on ut.id = u.type_id
    join public.unit_members um on um.unit_id = u.id
    where u.id = p_team
      and ut.is_team
      and u.status = 'active'
      and um.profile_id = auth.uid()
      and um.left_at is null
  ) then
    raise exception 'A unidade deve ser uma equipe ativa com vínculo aberto do membro' using errcode = '42501';
  end if;

  -- Validação do formato do valor cifrado
  if not app.is_encrypted_value(p_body_enc, 6000) then
    raise exception 'Conteúdo cifrado inválido ou excede o tamanho permitido' using errcode = '22023';
  end if;

  -- Limite anti-spam: máximo de 30 mensagens da mesma pessoa na mesma equipe nos últimos 10 minutos
  select count(*)
  into v_recent_count
  from public.team_messages
  where unit_id = p_team
    and author_id = auth.uid()
    and created_at >= now() - interval '10 minutes';

  if v_recent_count >= 30 then
    raise exception 'Limite de mensagens excedido nos últimos 10 minutos' using errcode = 'C7614';
  end if;

  insert into public.team_messages (
    unit_id,
    author_id,
    body_enc
  ) values (
    p_team,
    auth.uid(),
    p_body_enc
  )
  returning id into v_message_id;

  return v_message_id;
end;
$$;

-- Consulta de mensagens recentes da equipe em ordem cronológica crescente
create or replace function public.team_messages_for(
  p_team uuid,
  p_limit integer default 100
)
returns table (
  message_id uuid,
  author_id uuid,
  author_name_enc text,
  body_enc text,
  created_at timestamptz,
  is_mine boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not app.is_active_member() then
    raise exception 'Apenas membros ativos podem consultar mensagens' using errcode = '42501';
  end if;

  if not (
    exists (
      select 1
      from public.unit_members um
      where um.unit_id = p_team
        and um.profile_id = auth.uid()
        and um.left_at is null
    )
    or app.can_manage_unit(p_team)
  ) then
    raise exception 'Sem permissão para consultar mensagens desta equipe' using errcode = '42501';
  end if;

  -- Garante limite entre 1 e 200
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);

  return query
  select
    m.id as message_id,
    m.author_id,
    p.display_name_enc as author_name_enc,
    m.body_enc,
    m.created_at,
    (m.author_id = auth.uid()) as is_mine
  from (
    select tm.id, tm.author_id, tm.body_enc, tm.created_at
    from public.team_messages tm
    where tm.unit_id = p_team
    order by tm.created_at desc
    limit v_limit
  ) m
  left join public.profiles p on p.id = m.author_id
  order by m.created_at asc;
end;
$$;

-- Equipe vinculada atualmente ao usuário chamador
create or replace function public.my_open_team()
returns table (
  team_id uuid,
  team_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_active_member() then
    return;
  end if;

  return query
  select
    u.id as team_id,
    u.name as team_name
  from public.unit_members um
  join public.units u on u.id = um.unit_id
  join public.unit_types ut on ut.id = u.type_id
  where um.profile_id = auth.uid()
    and um.left_at is null
    and ut.is_team
    and u.status = 'active';
end;
$$;

-- Permissões de execução das funções públicas
revoke all on function public.post_team_message(uuid, text) from public, anon;
grant execute on function public.post_team_message(uuid, text) to authenticated;

revoke all on function public.team_messages_for(uuid, integer) from public, anon;
grant execute on function public.team_messages_for(uuid, integer) to authenticated;

revoke all on function public.my_open_team() from public, anon;
grant execute on function public.my_open_team() to authenticated;
