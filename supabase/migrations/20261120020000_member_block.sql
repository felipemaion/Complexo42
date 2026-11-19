-- Bloquear e desbloquear quem já está ativo (issue #26, ADR 0008 §1).
--
-- A fila de espera (`decide_access`) só decide quem está em `waitlisted`. Aqui o gestor
-- (manager) bloqueia quem já entrou, por exemplo quando alguém se cadastrou com o e-mail de
-- outra pessoa (reclamação), e desfaz o bloqueio.
--
-- 1. `app.is_outranked_by_caller(target)`: todo papel ativo de `target` está numa unidade
--    estritamente abaixo de uma unidade em que quem chama é manager (como `can_grant_role`).
--    Quem tem papel no mesmo nível, acima ou em outro ramo não é bloqueado por quem chama.
--    Exceção (como `can_revoke_role`): o manager da raiz também alcança `house_coordinator` e
--    `tech_admin` na raiz, que não têm ninguém acima. Um manager da raiz nunca é bloqueável.
-- 2. `app.can_block_member(target)` / `app.can_unblock_member(target)`: `manages_member`
--    (escopo, nunca a si mesmo, quem chama ativo) + `is_outranked_by_caller` + o alvo está
--    `active` (bloquear) ou `blocked` (desbloquear).
-- 3. `block_member(email, reason)` / `unblock_member(email)`: a coordenação conhece a pessoa
--    pelo e-mail da reclamação. A resposta é neutra no retorno (nada), exista ou não a conta,
--    esteja ou não no escopo. Só quem não é manager ativo recebe erro (42501), e isso não diz
--    nada sobre o alvo.
--    - Bloquear: `access_status = 'blocked'` na hora. `app.is_active_member()` e
--      `app.is_active_profile()` leem esse campo: a RLS nega o acesso já na próxima consulta
--      (a pessoa perde o escopo e some de perfil, contato e vínculos de terceiros, ADR 0010).
--      O cookie de sessão só é limpo no próximo acesso dela ao app (`requireUser`); o token
--      de refresh continua válido até expirar, sem efeito, porque a RLS já nega tudo. Papéis
--      não são revogados: só voltam a valer se a pessoa for liberada de novo.
--    - Desbloquear: volta para `waitlisted`, não direto para `active`: a pessoa reaparece na
--      fila de espera. A importação da lista NÃO a libera sozinha: o HMAC do e-mail só fica
--      guardado (`access_waitlist_hmac`) para quem foi à espera no primeiro login. A liberação
--      passa por uma decisão explícita na fila.
--    - Limite: 30 tentativas (block + unblock, inclusive as que não mudam nada) por hora por
--      quem chama, em `app.member_block_attempts` (só quem e quando, nunca o e-mail). Acima
--      disso, erro 54000 (`program_limit_exceeded`), como o `view_contact` (ADR 0010).
-- 4. `audit_log`: `member_blocked` (motivo opcional, de uma lista fechada: nada de texto livre
--    nem dado pessoal) e `member_unblocked` (sem motivo).

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked'
));

-- Redefinida inteira (a última migration vence; ver 20261119210000_contact_visibility.sql).
alter table public.audit_log
  drop constraint audit_log_reason_by_event,
  add constraint audit_log_reason_by_event check (
    case
      when event in ('access_granted', 'access_blocked') then coalesce(reason in ('manual', 'import'), false)
      when event = 'house_accepted' then coalesce(reason in ('self', 'questionnaire'), false)
      when event = 'contact_viewed' then coalesce(reason in ('whatsapp', 'social', 'email'), false)
      when event = 'member_blocked' then reason is null or reason in ('impersonation', 'conduct', 'other')
      else reason is null
    end
  );

-- ---------------------------------------------------------------------------------------
-- Funções de decisão
-- ---------------------------------------------------------------------------------------
create or replace function app.is_outranked_by_caller(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target is not null
    and not exists (
      select 1
      from public.role_assignments as r
      join public.units as u on u.id = r.unit_id
      where r.profile_id = target
        and r.revoked_at is null
        and not exists (
          select 1 from app.my_scopes() as s
          where s.role = 'manager'
            and u.path operator(extensions.<@) s.unit_path
            and u.path operator(extensions.<>) s.unit_path
        )
        and not (
          r.role in ('house_coordinator', 'tech_admin')
          and u.parent_id is null
          and app.manages_root()
        )
    );
$$;

comment on function app.is_outranked_by_caller(uuid) is
  'Todo papel ativo do alvo está abaixo de uma unidade em que quem chama é manager (ou é house_coordinator/tech_admin na raiz, para o manager da raiz).';

-- Quem chama pode usar o bloqueio: está ativo e é manager em alguma unidade. Não depende do
-- alvo, então negar aqui (42501) não revela nada sobre ele.
create or replace function app.can_block_members()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and exists (select 1 from app.my_scopes() as s where s.role = 'manager');
$$;

comment on function app.can_block_members() is
  'Quem chama está ativo e é manager em alguma unidade (abre as telas de bloqueio).';

create or replace function app.can_block_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.manages_member(target)
    and app.is_outranked_by_caller(target)
    and exists (
      select 1 from public.profiles as p
      where p.id = target and p.access_status = 'active'
    );
$$;

comment on function app.can_block_member(uuid) is
  'O gestor no escopo bloqueia quem está ativo; nunca a si nem quem tem papel no seu nível ou acima.';

create or replace function app.can_unblock_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.manages_member(target)
    and app.is_outranked_by_caller(target)
    and exists (
      select 1 from public.profiles as p
      where p.id = target and p.access_status = 'blocked'
    );
$$;

comment on function app.can_unblock_member(uuid) is
  'O gestor no escopo devolve à fila de espera quem está bloqueado (mesmas regras do bloqueio).';

revoke execute on function
  app.is_outranked_by_caller(uuid),
  app.can_block_members(),
  app.can_block_member(uuid),
  app.can_unblock_member(uuid)
from public, anon;

grant execute on function
  app.is_outranked_by_caller(uuid),
  app.can_block_members(),
  app.can_block_member(uuid),
  app.can_unblock_member(uuid)
to authenticated;

-- ---------------------------------------------------------------------------------------
-- Apoio às RPCs (sem acesso pela API)
-- ---------------------------------------------------------------------------------------
-- A conta do e-mail de login (`auth.users`, onde o e-mail já está). Só uma conta exata;
-- nenhuma ou mais de uma devolve nulo. O e-mail chega já normalizado e validado.
create or replace function app.account_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(u.id))[1] end
  from auth.users as u
  where lower(u.email) = p_email;
$$;

-- O servidor manda o e-mail em minúsculas e sem espaços (`normalizeAllowlistEmail`); a mesma
-- regra aqui, para não haver duas formas de comparar.
create or replace function app.require_normalized_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_email is null or length(p_email) > 254 or p_email !~ '^[^[:space:]@A-Z]+@[^[:space:]@A-Z]+$' then
    raise exception 'e-mail em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  return p_email;
end;
$$;

revoke execute on function app.account_by_email(text), app.require_normalized_email(text)
  from public, anon, authenticated;

-- Tentativas de bloqueio e desbloqueio: só quem e quando (nada do e-mail nem do alvo). Fica no
-- banco, e não na memória do servidor, para valer com vários processos e depois de reinícios.
create table app.member_block_attempts (
  actor_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

comment on table app.member_block_attempts is
  'Tentativas de block_member/unblock_member (#26): só quem e quando, para o limite por hora.';

create index member_block_attempts_actor_idx on app.member_block_attempts (actor_id, attempted_at);
create index member_block_attempts_at_idx on app.member_block_attempts (attempted_at);

alter table app.member_block_attempts enable row level security;
revoke all on app.member_block_attempts from public, anon, authenticated, service_role;
create policy member_block_attempts_no_api_access on app.member_block_attempts
  for all to anon, authenticated
  using (false)
  with check (false);

-- Conta a tentativa de quem chama ou recusa (54000) quem já fez 30 na última hora. O lock por
-- quem chama impede que pedidos simultâneos passem do limite. Limpeza oportunista: apaga as
-- tentativas de mais de uma hora (de todos).
create or replace function app.count_member_block_attempt()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_attempts_per_hour constant integer := 30;
begin
  perform pg_advisory_xact_lock(hashtextextended('member_block:' || caller::text, 0));
  if (
    select count(*) from app.member_block_attempts as a
    where a.actor_id = caller and a.attempted_at > now() - interval '1 hour'
  ) >= max_attempts_per_hour then
    raise exception 'too_many_attempts' using errcode = 'program_limit_exceeded';
  end if;
  delete from app.member_block_attempts where attempted_at <= now() - interval '1 hour';
  insert into app.member_block_attempts (actor_id) values (caller);
end;
$$;

revoke execute on function app.count_member_block_attempt() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------
create or replace function public.block_member(p_email text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not app.can_block_members() then
    raise exception 'só a coordenação bloqueia acessos' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is not null and p_reason not in ('impersonation', 'conduct', 'other') then
    raise exception 'motivo inválido' using errcode = 'invalid_parameter_value';
  end if;
  perform app.require_normalized_email(p_email);
  perform app.count_member_block_attempt();
  target := app.account_by_email(p_email);

  -- Permissão antes da trava (quem não pode não trava a linha de ninguém) e de novo depois
  -- dela (outra decisão simultânea pode ter mudado o estado).
  if not app.can_block_member(target) then
    return;
  end if;
  perform 1 from public.profiles as p where p.id = target for update;
  if not app.can_block_member(target) then
    return;
  end if;

  update public.profiles set access_status = 'blocked' where id = target;

  insert into public.audit_log (actor_id, event, target_id, reason)
  values ((select auth.uid()), 'member_blocked', target, p_reason);
end;
$$;

comment on function public.block_member(text, text) is
  'Gestor bloqueia quem está ativo no seu escopo. Resposta neutra no retorno; até 30 tentativas por hora.';

create or replace function public.unblock_member(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not app.can_block_members() then
    raise exception 'só a coordenação desbloqueia acessos' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_normalized_email(p_email);
  perform app.count_member_block_attempt();
  target := app.account_by_email(p_email);

  if not app.can_unblock_member(target) then
    return;
  end if;
  perform 1 from public.profiles as p where p.id = target for update;
  if not app.can_unblock_member(target) then
    return;
  end if;

  update public.profiles set access_status = 'waitlisted' where id = target;

  insert into public.audit_log (actor_id, event, target_id)
  values ((select auth.uid()), 'member_unblocked', target);
end;
$$;

comment on function public.unblock_member(text) is
  'Gestor devolve à fila de espera quem está bloqueado no seu escopo. Resposta neutra no retorno; até 30 por hora.';

revoke execute on function public.block_member(text, text), public.unblock_member(text)
  from public, anon;
grant execute on function public.block_member(text, text), public.unblock_member(text)
  to authenticated;
