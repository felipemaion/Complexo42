-- Delegação de papéis por escopo (#22, ADR 0002, regra 5): rastro de toda concessão e revogação, `revoked_by` e a concessão por
-- e-mail para a tela da coordenação.
--
-- QUEM concede o quê não muda: `app.can_grant_role` (só um manager ativo, numa unidade ESTRITAMENTE abaixo do seu escopo,
-- nunca a si mesmo; o manager da raiz só pelo tech_admin; o coordenador nacional de casa pelo manager da raiz) e
-- `app.can_revoke_role` (quem concedeu, ou manager acima). O que entra aqui:
--   1. `revoked_by`: quem revogou, gravado pelo banco (a API não escreve a coluna);
--   2. um gatilho que grava `role_granted` e `role_revoked` no `audit_log` (ator e alvo, nada mais) em TODO caminho com sessão
--      (a escrita direta pela API e as funções), na mesma transação. Sem sessão (`auth.uid()` nulo: o operador por SQL e o
--      bootstrap) o gatilho não grava: quem mexe à mão grava o evento à mão, como o bootstrap já faz (docs/OPERACAO.md);
--   3. `public.grant_role_by_email`: concede pelo e-mail, no padrão do `block_member` (#26): busca a conta em `auth.users`
--      (`app.account_by_email`), limite de tentativas por hora e resposta NEUTRA: e-mail sem conta, pessoa fora do escopo e
--      papel que não se pode dar dão o mesmo resultado (nada), para o gestor não enumerar contas fora do escopo dele.

-- ---------------------------------------------------------------------------------------
-- 1. revoked_by
-- ---------------------------------------------------------------------------------------
alter table public.role_assignments
  add column revoked_by uuid references auth.users (id) on delete set null;

comment on column public.role_assignments.revoked_by is
  'Quem revogou (#22). Gravado pelo banco na revogação; a API não escreve a coluna. Nulo se a revogação foi pelo operador sem sessão.';

-- Na revogação (nulo → data), `revoked_by` é quem está na sessão (o operador, sem sessão, pode informar à mão). Depois disso não
-- muda, salvo o nulo da cascata quando a conta de quem revogou é excluída (como o `ended_by`, #18).
create or replace function app.tg_role_assignments_revoked_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_by := coalesce((select auth.uid()), new.revoked_by);
  elsif new.revoked_by is distinct from old.revoked_by then
    if not (new.revoked_by is null and old.revoked_by is not null
            and not exists (select 1 from auth.users as u where u.id = old.revoked_by)) then
      new.revoked_by := old.revoked_by;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function app.tg_role_assignments_revoked_by() from public, anon, authenticated;

create trigger role_assignments_revoked_by
  before update on public.role_assignments
  for each row execute function app.tg_role_assignments_revoked_by();

-- ---------------------------------------------------------------------------------------
-- 2. Rastro de concessão e revogação
-- ---------------------------------------------------------------------------------------
create or replace function app.tg_role_assignments_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  -- Sem sessão (operador, bootstrap): quem grava à mão grava o evento à mão.
  if actor is null then
    return null;
  end if;
  if tg_op = 'INSERT' and new.revoked_at is null then
    insert into public.audit_log (actor_id, event, target_id) values (actor, 'role_granted', new.profile_id);
  elsif tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null then
    insert into public.audit_log (actor_id, event, target_id) values (actor, 'role_revoked', new.profile_id);
  end if;
  return null;
end;
$$;

revoke execute on function app.tg_role_assignments_audit() from public, anon, authenticated;

create trigger role_assignments_audit
  after insert or update of revoked_at on public.role_assignments
  for each row execute function app.tg_role_assignments_audit();

-- ---------------------------------------------------------------------------------------
-- 3. Concessão por e-mail
-- ---------------------------------------------------------------------------------------
-- Tentativas: só quem e quando (nada do e-mail nem do alvo), como `app.member_block_attempts`.
create table app.role_grant_attempts (
  actor_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

comment on table app.role_grant_attempts is
  'Tentativas de grant_role_by_email (#22): só quem e quando, para o limite por hora.';

create index role_grant_attempts_actor_idx on app.role_grant_attempts (actor_id, attempted_at);
create index role_grant_attempts_at_idx on app.role_grant_attempts (attempted_at);

alter table app.role_grant_attempts enable row level security;
revoke all on app.role_grant_attempts from public, anon, authenticated, service_role;
create policy role_grant_attempts_no_api_access on app.role_grant_attempts
  for all to anon, authenticated
  using (false)
  with check (false);

-- Conta a tentativa de quem chama ou recusa (54000) quem já fez 30 na última hora. Limpeza oportunista das antigas.
create or replace function app.count_role_grant_attempt()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_attempts_per_hour constant integer := 30;
begin
  perform pg_advisory_xact_lock(hashtextextended('role_grant:' || caller::text, 0));
  if (
    select count(*) from app.role_grant_attempts as a
    where a.actor_id = caller and a.attempted_at > now() - interval '1 hour'
  ) >= max_attempts_per_hour then
    raise exception 'too_many_attempts' using errcode = 'program_limit_exceeded';
  end if;
  delete from app.role_grant_attempts where attempted_at <= now() - interval '1 hour';
  insert into app.role_grant_attempts (actor_id) values (caller);
end;
$$;

revoke execute on function app.count_role_grant_attempt() from public, anon, authenticated;

-- Concede `p_role` em `p_unit` a quem tem a conta do e-mail. Só os papéis de território que se delegam pela tela (monitor,
-- manager, spokesperson); o coordenador de casa segue pelas telas da casa. Além de `app.can_grant_role`, a pessoa precisa
-- estar ativa e no escopo de quem concede (`app.manages_member`). Qualquer recusa é silenciosa (resposta neutra); o rastro
-- (`role_granted`) sai pelo gatilho, com o ator da sessão.
create or replace function public.grant_role_by_email(p_email text, p_role text, p_unit uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target uuid;
begin
  if caller is null or not app.is_active_member() then
    raise exception 'sessão de membro ativo obrigatória' using errcode = 'insufficient_privilege';
  end if;
  perform app.require_normalized_email(p_email);
  perform app.count_role_grant_attempt();
  target := app.account_by_email(p_email);

  if target is null
     or p_role is null or p_role not in ('monitor', 'manager', 'spokesperson')
     or p_unit is null
     or not app.is_active_profile(target)
     or not app.manages_member(target)
     or not app.can_grant_role(p_role, p_unit, target) then
    return;
  end if;
  if exists (
    select 1 from public.role_assignments as r
    where r.profile_id = target and r.role = p_role and r.unit_id = p_unit and r.house_key is null and r.revoked_at is null
  ) then
    return;
  end if;

  insert into public.role_assignments (profile_id, role, unit_id, granted_by)
  values (target, p_role, p_unit, caller);
end;
$$;

comment on function public.grant_role_by_email(text, text, uuid) is
  'Concede um papel de território pelo e-mail (#22). Resposta neutra; limite de 30 tentativas por hora; rastro pelo gatilho.';

revoke execute on function public.grant_role_by_email(text, text, uuid) from public, anon;
grant execute on function public.grant_role_by_email(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
