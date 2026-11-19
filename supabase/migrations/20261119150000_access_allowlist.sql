-- Lista de autorizados e lista de espera (issue #26, ADR 0008 §1; HMAC do ADR 0003).
--
-- 1. `access_allowlist`: só o HMAC do e-mail normalizado (domínio "em:"), calculado no
--    servidor (`src/server/crypto/`). O banco não tem a chave e não vê e-mail nenhum.
--    Ninguém lê nem grava a tabela pela API: só as funções abaixo.
-- 1b. `access_waitlist_hmac`: o HMAC de quem foi para a espera no primeiro login, para a
--    importação seguinte liberar a pessoa sozinha (decisão do gestor em 2026-11-19). Privada
--    como a lista: nenhuma função devolve o HMAC. Não expõe nada novo: o e-mail da conta já
--    está em `auth.users`.
-- 2. `audit_log` (docs/MODELO_DADOS.md): sem dado pessoal; gravado só pelas funções
--    `security definer`; lido só por gestores, dentro do escopo.
-- 3. Funções de decisão (R15), usadas pelas políticas e pelas RPCs:
--    - `app.manages_root()`: quem chama é gestor (manager) da raiz e está ativo;
--    - `app.can_import_allowlist()`: só o gestor da raiz importa (a lista vale para a
--      instância inteira); tech_admin não (papel de sistema, sem dado de pessoas, ADR 0002);
--    - `app.manages_member(target)`: gestor com escopo sobre o vínculo aberto do alvo (ou o
--      gestor da raiz, se o alvo não tem vínculo), nunca sobre si mesmo;
--    - `app.can_decide_access(target)`: `manages_member` e o alvo está em `waitlisted`;
--    - `app.can_read_audit(event, target)`.
-- 4. RPCs em `public` (o PostgREST só expõe `public`), todas `security definer`:
--    - `resolve_access(email_hmac)`: no primeiro login, decide o próprio `access_status`;
--    - `import_allowlist(email_hmacs, source)`: importação pelo gestor, auditada com a
--      quantidade;
--    - `list_waitlist(limit, cursor)` e `decide_access(profile, decision)`: fila de espera do
--      gestor.
--
-- `status` (situação da conta) sai de `pending` para `active` junto com a liberação: sem
-- isso ninguém ficaria ativo (`app.is_active_profile` exige os dois). `suspended` não muda.

-- ---------------------------------------------------------------------------------------
-- access_allowlist
-- ---------------------------------------------------------------------------------------
create table public.access_allowlist (
  id uuid primary key default gen_random_uuid(),
  -- HMAC-SHA256 em hex de "em:" + e-mail em minúsculas e sem espaços (ADR 0003 §3).
  email_hmac text not null
    constraint access_allowlist_email_hmac_format check (email_hmac ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('form', 'academy', 'manual')),
  -- Quem importou. Sem FK: a entrada continua valendo se a conta de quem importou sair.
  added_by uuid,
  added_at timestamptz not null default now(),
  constraint access_allowlist_email_hmac_key unique (email_hmac)
);

comment on table public.access_allowlist is
  'Lista de autorizados (ADR 0008 §1): só o HMAC do e-mail. Ninguém lê pela API.';

alter table public.access_allowlist enable row level security;

-- ---------------------------------------------------------------------------------------
-- access_waitlist_hmac
-- ---------------------------------------------------------------------------------------
create table public.access_waitlist_hmac (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  -- O HMAC que a pessoa apresentou no primeiro login (o do e-mail confirmado da sessão).
  -- Sem índice único: um HMAC repetido não pode impedir o cadastro de outra conta.
  email_hmac text not null
    constraint access_waitlist_hmac_email_hmac_format check (email_hmac ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

comment on table public.access_waitlist_hmac is
  'HMAC de quem está na espera, para a importação liberar sozinha (ADR 0008 §1). Sem API.';

create index access_waitlist_hmac_email_hmac_idx on public.access_waitlist_hmac (email_hmac);

alter table public.access_waitlist_hmac enable row level security;

-- ---------------------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  -- Sem FK: o registro sobrevive à exclusão da conta (`account_deleted`).
  actor_id uuid,
  event text not null check (event in (
    'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
    'export', 'badge_granted', 'badge_revoked', 'submission_approved',
    'submission_rejected', 'points_adjusted', 'account_deleted',
    'allowlist_imported', 'access_granted', 'access_blocked'
  )),
  target_id uuid,
  -- Quantidade de itens de um evento em lote (`allowlist_imported`), nunca os itens.
  item_count integer check (item_count >= 0),
  -- Motivo de uma decisão de acesso: `manual` (gestor, pela fila) ou `import` (liberação
  -- automática na importação da lista). Só em `access_granted`/`access_blocked`.
  reason text check (reason in ('manual', 'import')),
  created_at timestamptz not null default now(),
  constraint audit_log_item_count_only_for_batches
    check ((event = 'allowlist_imported') = (item_count is not null)),
  constraint audit_log_reason_only_for_access
    check ((event in ('access_granted', 'access_blocked')) = (reason is not null))
);

comment on table public.audit_log is
  'Auditoria sem dado pessoal. Gravada só por funções do banco; lida por gestores no escopo.';

-- Só aceita inserções: nem o dono do banco altera ou apaga um registro. Limpeza (retenção,
-- LGPD) exige migration própria que desligue este trigger de forma explícita e auditável.
create or replace function app.tg_audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log só aceita inserções'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function app.tg_audit_log_append_only() from public;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.tg_audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function app.tg_audit_log_append_only();

create index audit_log_target_id_idx on public.audit_log (target_id);
create index audit_log_created_at_idx on public.audit_log (created_at);

alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------------------
-- Funções de decisão
-- ---------------------------------------------------------------------------------------
create or replace function app.manages_root()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (
      select 1 from public.units as u
      where u.parent_id is null
        and app.has_scope_over(u.path, array['manager'])
    );
$$;

comment on function app.manages_root() is
  'Quem chama é gestor (manager) da raiz e está ativo.';

create or replace function app.can_import_allowlist()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.manages_root();
$$;

comment on function app.can_import_allowlist() is
  'Só o gestor da raiz importa a lista de autorizados (vale para a instância toda).';

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

comment on function app.manages_member(uuid) is
  'Gestor com escopo sobre o vínculo aberto do alvo; sem vínculo, só o gestor da raiz. Nunca a si.';

create or replace function app.can_decide_access(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.manages_member(target)
    and exists (
      select 1 from public.profiles as p
      where p.id = target and p.access_status = 'waitlisted'
    );
$$;

comment on function app.can_decide_access(uuid) is
  'O gestor no escopo aprova ou bloqueia quem está na lista de espera (ADR 0008 §1).';

create or replace function app.can_read_audit(event text, target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and (
      (event = 'allowlist_imported' and app.manages_root())
      or (target is not null and app.manages_member(target))
    );
$$;

comment on function app.can_read_audit(text, uuid) is
  'Só gestores leem a auditoria: a importação, o da raiz; o resto, se o alvo está no escopo.';

revoke execute on function
  app.manages_root(),
  app.can_import_allowlist(),
  app.manages_member(uuid),
  app.can_decide_access(uuid),
  app.can_read_audit(text, uuid)
from public, anon;

grant execute on function
  app.manages_root(),
  app.can_import_allowlist(),
  app.manages_member(uuid),
  app.can_decide_access(uuid),
  app.can_read_audit(text, uuid)
to authenticated;

-- ---------------------------------------------------------------------------------------
-- Grants e políticas
-- ---------------------------------------------------------------------------------------
revoke all on public.access_allowlist, public.access_waitlist_hmac, public.audit_log
  from anon, authenticated;

-- A lista não tem grant nenhum para a API. A política explícita só documenta a regra (R5):
-- mesmo com um grant por engano, nenhuma linha apareceria.
create policy access_allowlist_no_api_access on public.access_allowlist
  for all to anon, authenticated
  using (false)
  with check (false);

create policy access_waitlist_hmac_no_api_access on public.access_waitlist_hmac
  for all to anon, authenticated
  using (false)
  with check (false);

-- Auditoria: só leitura, e só pelos gestores. Ninguém grava, altera nem apaga pela API.
grant select on public.audit_log to authenticated;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (app.can_read_audit(event, target_id));

-- ---------------------------------------------------------------------------------------
-- RPC: primeiro login
-- ---------------------------------------------------------------------------------------
-- O servidor calcula o HMAC do e-mail da sessão e chama esta função com o JWT da pessoa.
-- Ela só mexe no perfil de quem chama, e só uma vez: em `pending` vira `active` (HMAC na
-- lista) ou `waitlisted`; em qualquer outro estado devolve o estado atual sem consultar a
-- lista. Sem perfil, devolve nulo sem consultar a lista. Ao mandar para a espera, guarda o
-- HMAC em `access_waitlist_hmac` (a importação seguinte libera; ver `import_allowlist`). Assim a função não serve para
-- testar HMACs em série: cada conta tem uma única consulta, e ela só devolve o estado de
-- quem chama, nunca dados da lista.
create or replace function public.resolve_access(p_email_hmac text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  current_status text;
  decided text;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if p_email_hmac is null or p_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'HMAC em formato inválido' using errcode = 'invalid_parameter_value';
  end if;

  -- Trava a linha: duas chamadas simultâneas não decidem duas vezes.
  select p.access_status into current_status
  from public.profiles as p
  where p.id = caller
  for update;

  if current_status is null or current_status <> 'pending' then
    return current_status;
  end if;

  decided := case
    when exists (select 1 from public.access_allowlist as a where a.email_hmac = p_email_hmac)
      then 'active'
    else 'waitlisted'
  end;

  update public.profiles
  set access_status = decided,
      status = case when decided = 'active' and status = 'pending' then 'active' else status end
  where id = caller;

  -- Na espera: guarda o HMAC para a próxima importação que o trouxer liberar a pessoa.
  if decided = 'waitlisted' then
    insert into public.access_waitlist_hmac (profile_id, email_hmac)
    values (caller, p_email_hmac)
    on conflict (profile_id) do update set email_hmac = excluded.email_hmac, created_at = now();
  end if;

  return decided;
end;
$$;

comment on function public.resolve_access(text) is
  'Primeiro login: pending → active (HMAC na lista) ou waitlisted. Só o próprio perfil, uma vez.';

-- ---------------------------------------------------------------------------------------
-- RPC: importação da lista
-- ---------------------------------------------------------------------------------------
-- Recebe só HMACs (o servidor lê o CSV, calcula e descarta os e-mails). Devolve e audita a
-- quantidade de HMACs distintos recebidos, e não a de novos: assim nem quem importa
-- descobre se um e-mail já estava na lista.
--
-- Depois de gravar, libera quem está na espera (`waitlisted`, conta não suspensa) com o HMAC
-- guardado entre os importados: `access_status` e `status` viram `active`, a linha sai de
-- `access_waitlist_hmac` e cada pessoa liberada gera um `access_granted` com
-- `reason = 'import'`. Um evento por pessoa (e não um agregado) porque é o `target_id` que
-- deixa o gestor de cada estado ver, no seu escopo, quem entrou e por quê. `blocked` nunca é
-- liberado aqui. Devolve `{received, promoted}`: quem importa é o gestor da raiz, que já vê
-- a fila inteira.
create or replace function public.import_allowlist(p_email_hmacs text[], p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  received integer;
  promoted integer;
begin
  if not app.can_import_allowlist() then
    raise exception 'só o gestor importa a lista' using errcode = 'insufficient_privilege';
  end if;
  if p_source is null or p_source not in ('form', 'academy', 'manual') then
    raise exception 'origem inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_email_hmacs is null or cardinality(p_email_hmacs) = 0
     or cardinality(p_email_hmacs) > 50000 then
    raise exception 'a lista precisa ter de 1 a 50000 itens' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from unnest(p_email_hmacs) as h(v)
    where h.v is null or h.v !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'HMAC em formato inválido' using errcode = 'invalid_parameter_value';
  end if;

  select count(distinct h.v)::integer into received from unnest(p_email_hmacs) as h(v);

  insert into public.access_allowlist (email_hmac, source, added_by)
  select distinct h.v, p_source, (select auth.uid())
  from unnest(p_email_hmacs) as h(v)
  on conflict (email_hmac) do nothing;

  insert into public.audit_log (actor_id, event, item_count)
  values ((select auth.uid()), 'allowlist_imported', received);

  with released as (
    update public.profiles as p
    set access_status = 'active', status = 'active'
    from public.access_waitlist_hmac as w
    where w.profile_id = p.id
      and p.access_status = 'waitlisted'
      and p.status <> 'suspended'
      and w.email_hmac = any (p_email_hmacs)
    returning p.id
  ),
  forgotten as (
    delete from public.access_waitlist_hmac as w
    using released as r
    where w.profile_id = r.id
  ),
  audited as (
    insert into public.audit_log (actor_id, event, target_id, reason)
    select (select auth.uid()), 'access_granted', r.id, 'import' from released as r
  )
  select count(*)::integer into promoted from released;

  return jsonb_build_object('received', received, 'promoted', promoted);
end;
$$;

comment on function public.import_allowlist(text[], text) is
  'Importação pelo gestor da raiz: só HMACs; audita a quantidade e libera quem espera com HMAC importado.';

-- ---------------------------------------------------------------------------------------
-- RPC: fila de espera
-- ---------------------------------------------------------------------------------------
-- Quem está na espera não aparece em busca nem em painel (a RLS de `profiles` só mostra
-- perfis ativos a terceiros). A fila é a única exceção: o gestor no escopo vê quem espera
-- para decidir. O nome vem cifrado; o servidor decifra.
-- Paginada por cursor (mais antigos primeiro): `p_limit` de 1 a 200 e, a partir da segunda
-- página, o `created_at` e o `profile_id` do último item recebido.
create or replace function public.list_waitlist(
  p_limit integer default 50,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  profile_id uuid,
  display_name_enc text,
  municipality_code integer,
  state_code char(2),
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'limite precisa ser de 1 a 200' using errcode = 'invalid_parameter_value';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'cursor incompleto' using errcode = 'invalid_parameter_value';
  end if;

  return query
  select p.id, p.display_name_enc, p.municipality_code, p.state_code, p.created_at
  from public.profiles as p
  where p.access_status = 'waitlisted'
    and (p_after_created_at is null or (p.created_at, p.id) > (p_after_created_at, p_after_id))
    and app.can_decide_access(p.id)
  order by p.created_at, p.id
  limit p_limit;
end;
$$;

comment on function public.list_waitlist(integer, timestamptz, uuid) is
  'Fila de espera do gestor, paginada: só quem está em waitlisted dentro do escopo de quem chama.';

-- Aprova (`active`) ou bloqueia (`blocked`) quem está na espera, com auditoria. Fora do
-- escopo, perfil inexistente e perfil fora da espera dão o mesmo erro (sem oráculo).
create or replace function public.decide_access(p_profile uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_decision is null or p_decision not in ('active', 'blocked') then
    raise exception 'decisão inválida' using errcode = 'invalid_parameter_value';
  end if;

  -- Permissão antes da trava: quem não pode decidir não chega a travar a linha de ninguém.
  if not app.can_decide_access(p_profile) then
    raise exception 'sem permissão para decidir este acesso'
      using errcode = 'insufficient_privilege';
  end if;

  -- Trava e confere de novo: outra decisão simultânea pode ter tirado o perfil da espera.
  perform 1 from public.profiles as p where p.id = p_profile for update;
  if not app.can_decide_access(p_profile) then
    raise exception 'sem permissão para decidir este acesso'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
  set access_status = p_decision,
      status = case when p_decision = 'active' and status = 'pending' then 'active' else status end
  where id = p_profile;

  -- Decidido à mão, o HMAC guardado não serve mais.
  delete from public.access_waitlist_hmac where profile_id = p_profile;

  insert into public.audit_log (actor_id, event, target_id, reason)
  values (
    (select auth.uid()),
    case p_decision when 'active' then 'access_granted' else 'access_blocked' end,
    p_profile,
    'manual'
  );

  return p_decision;
end;
$$;

comment on function public.decide_access(uuid, text) is
  'Gestor no escopo aprova (access_granted) ou bloqueia (access_blocked) quem está na espera.';

revoke execute on function
  public.resolve_access(text),
  public.import_allowlist(text[], text),
  public.list_waitlist(integer, timestamptz, uuid),
  public.decide_access(uuid, text)
from public, anon;

grant execute on function
  public.resolve_access(text),
  public.import_allowlist(text[], text),
  public.list_waitlist(integer, timestamptz, uuid),
  public.decide_access(uuid, text)
to authenticated;
