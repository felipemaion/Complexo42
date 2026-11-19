-- Bloquear e desbloquear quem já está ativo (issue #26, ADR 0008 §1).
--
-- A fila de espera (`decide_access`) só decide quem está em `waitlisted`. Aqui o gestor
-- (manager) bloqueia quem já entrou, por exemplo quando alguém se cadastrou com o e-mail de
-- outra pessoa (reclamação), e desfaz o bloqueio.
--
-- 1. `app.is_outranked_by_caller(target)`: todo papel ativo de `target` está numa unidade
--    estritamente abaixo de uma unidade em que quem chama é manager (como `can_grant_role`).
--    Quem tem papel no mesmo nível, acima ou em outro ramo não é bloqueado por quem chama.
-- 2. `app.can_block_member(target)` / `app.can_unblock_member(target)`: `manages_member`
--    (escopo, nunca a si mesmo, quem chama ativo) + `is_outranked_by_caller` + o alvo está
--    `active` (bloquear) ou `blocked` (desbloquear).
-- 3. `block_member(email, reason)` / `unblock_member(email)`: a coordenação conhece a pessoa
--    pelo e-mail da reclamação. A resposta é sempre a mesma (nada), exista ou não a conta,
--    esteja ou não no escopo: a função não serve para descobrir quem está cadastrado. Só quem
--    não é manager ativo recebe erro (42501), e isso não diz nada sobre o alvo.
--    - Bloquear: `access_status = 'blocked'` na hora. `app.is_active_member()` e
--      `app.is_active_profile()` leem esse campo: a pessoa perde o escopo e some de perfil,
--      contato e vínculos de terceiros (ADR 0010) já na próxima consulta; o servidor encerra
--      a sessão dela (`requireUser`). Papéis não são revogados: só voltam a valer se a
--      pessoa for liberada de novo.
--    - Desbloquear: volta para `waitlisted`, não direto para `active`: a pessoa reaparece na
--      fila de espera e a liberação passa de novo por uma decisão explícita da coordenação.
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
    );
$$;

comment on function app.is_outranked_by_caller(uuid) is
  'Todo papel ativo do alvo está estritamente abaixo de uma unidade em que quem chama é manager.';

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
  target := app.account_by_email(app.require_normalized_email(p_email));

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
  'Gestor bloqueia quem está ativo no seu escopo. Resposta neutra: não revela se a conta existe.';

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
  target := app.account_by_email(app.require_normalized_email(p_email));

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
  'Gestor devolve à fila de espera quem está bloqueado no seu escopo. Resposta neutra.';

revoke execute on function public.block_member(text, text), public.unblock_member(text)
  from public, anon;
grant execute on function public.block_member(text, text), public.unblock_member(text)
  to authenticated;
