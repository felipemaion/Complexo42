-- "Excluir minha conta" (issue #18, LGPD art. 18, VI): exclusão real, feita pela própria pessoa.
--
-- 1. `public.delete_own_account()` (`security definer`), chamada pelo servidor
--    com o JWT de quem está logado (R14). Não recebe parâmetro: só apaga `auth.uid()`. Por que
--    no banco e não pela API de admin do GoTrue: a API de admin exige a chave `service_role`
--    no servidor do app, que hoje não a tem (R6 e o princípio de não guardar segredo com
--    acesso total onde não precisa). Aqui, o máximo que um JWT válido consegue é apagar a
--    PRÓPRIA conta. O dono da função é quem roda as migrations: `supabase_admin`
--    (superusuário) no auto-hospedado (job de migrations, docs/OPERACAO.md; lá o `postgres` é
--    NOLOGIN) e `postgres` no `supabase start` local, que tem DELETE em `auth.users` e SELECT em
--    `auth.sessions` (conferido). As tabelas do GoTrue que dependem do usuário (sessões,
--    identidades, tokens, MFA) têm FK `on delete cascade`.
-- 2. Reautenticação recente, conferida AQUI (não só na tela): a sessão do JWT (`session_id`,
--    assinado pelo GoTrue) precisa existir em `auth.sessions`, ser da própria pessoa e ter sido
--    criada (`created_at` = o login) há no máximo 10 minutos. Renovar o token não muda a
--    sessão nem o `created_at`. Sem `session_id`, com valor malformado ou sem a sessão: falha
--    fechado. Senão, erro `PT401` (`reauth_required`). Não depende do `amr`. Um cookie de
--    sessão roubado ou um aparelho esquecido aberto não bastam para apagar a conta.
-- 3. O que apaga: `auth.users` e, em cascata, `profiles`, `profile_contacts`, `unit_members`
--    e `role_assignments` da pessoa, `access_waitlist_hmac`, `questionnaire_consents`,
--    `app.profile_save_attempts`, sessões e identidades. Também o rastro que o próprio GoTrue
--    deixa com o e-mail e o IP (`auth.audit_log_entries`: pelo id ou pelo e-mail exato da
--    conta, lido antes de apagar) e os `auth.flow_state` (PKCE).
-- 4. Dados de OUTRAS pessoas que citam a conta apagada perdem só a referência:
--    `role_assignments.granted_by` e `unit_members.ended_by` viram nulos (FK `set null`).
--    O trigger de `ended_by` devolvia o valor antigo em qualquer UPDATE e quebrava a cascata;
--    agora aceita o nulo quando o perfil citado não existe mais (só a cascata faz isso: a API
--    não tem grant de escrita em `ended_by`).
-- 5. `audit_log` continua só-inserção (o trigger não muda). Os ids da conta apagada ficam nos
--    eventos antigos como uuid solto (sem FK, por desenho): sem `auth.users` e sem perfil,
--    nada no banco liga esse uuid a uma pessoa. A função grava `account_deleted` (ator e alvo
--    = o id apagado, sem nenhum dado pessoal), que também serve para reaplicar a exclusão
--    se um backup antigo for restaurado. Um trigger novo recusa evento cujo `actor_id` não
--    é uma conta existente: um JWT de conta já apagada (válido até expirar) não grava nada
--    com o uuid morto.
-- 6. `access_allowlist` (lista importada pela organização, só HMAC, sem ligação com a conta) não
--    muda: veja docs/MODELO_DADOS.md, "Excluir minha conta".

-- ---------------------------------------------------------------------------------------
-- ended_by: aceita o nulo da cascata
-- ---------------------------------------------------------------------------------------
create or replace function app.tg_unit_members_set_ended_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.left_at is null then
    new.ended_by := null;
  elsif tg_op = 'INSERT' or old.left_at is null then
    new.ended_by := (select auth.uid());
  elsif new.ended_by is null
        and old.ended_by is not null
        and not exists (select 1 from public.profiles as p where p.id = old.ended_by) then
    -- `on delete set null` de quem encerrou o vínculo e excluiu a conta (#18).
    new.ended_by := null;
  else
    new.ended_by := old.ended_by;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- delete_own_account
-- ---------------------------------------------------------------------------------------
create or replace function app.auth_age_seconds()
returns bigint
language sql
stable
set search_path = ''
as $$
  -- Segundos desde a criação (= login) da sessão do JWT. Null (falha fechado) sem
  -- `session_id`, com valor que não é uuid, ou sem a sessão da própria pessoa.
  select floor(extract(epoch from (now() - s.created_at)))::bigint
  from auth.sessions as s
  where s.id = case
                 when (select auth.jwt()) ->> 'session_id'
                      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then ((select auth.jwt()) ->> 'session_id')::uuid
               end
    and s.user_id = (select auth.uid())
    and s.created_at is not null;
$$;

comment on function app.auth_age_seconds() is
  'Segundos desde o login da sessão do JWT (auth.sessions.created_at). Exclusão de conta (#18).';

revoke execute on function app.auth_age_seconds() from public, anon, authenticated;

create or replace function public.delete_own_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  -- Igual a REAUTH_WINDOW_SECONDS em src/modules/privacy/domain/delete-account.ts.
  reauth_window constant bigint := 600;
  age bigint;
  login_email text;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  -- Uma exclusão por vez para a mesma conta.
  perform pg_advisory_xact_lock(hashtextextended('delete_own_account:' || caller::text, 0));
  if not exists (select 1 from auth.users as u where u.id = caller) then
    raise exception 'conta não encontrada' using errcode = 'insufficient_privilege';
  end if;

  age := app.auth_age_seconds();
  if age is null or age > reauth_window then
    raise exception 'entre de novo para confirmar a exclusão'
      using errcode = 'PT401', hint = 'reauth_required';
  end if;

  select u.email into login_email from auth.users as u where u.id = caller;

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'account_deleted', caller);

  -- Rastro do GoTrue com e-mail e IP (sem FK para auth.users).
  delete from auth.audit_log_entries as e
  where e.payload ->> 'actor_id' = caller::text
     or e.payload -> 'traits' ->> 'user_id' = caller::text
     or (login_email is not null and login_email <> ''
         and (e.payload ->> 'actor_username' = login_email
              or e.payload -> 'traits' ->> 'user_email' = login_email));
  delete from auth.flow_state as f where f.user_id = caller;

  -- O resto vai em cascata (ver o cabeçalho).
  delete from auth.users as u where u.id = caller;
end;
$$;

comment on function public.delete_own_account() is
  'Exclui a conta de quem chama (#18): exige login nos últimos 10 minutos; grava account_deleted.';

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- ---------------------------------------------------------------------------------------
-- audit_log: ator precisa ser uma conta existente
-- ---------------------------------------------------------------------------------------
-- Um JWT continua válido até expirar mesmo depois da exclusão. Sem isto, uma função que grava
-- evento com `auth.uid()` (ex.: `export_own_data`) gravaria o uuid de uma conta que não existe
-- mais. Só restringe inserções: o log continua só-inserção como antes. `account_deleted` é
-- gravado antes de apagar `auth.users`, então passa.
create or replace function app.tg_audit_log_actor_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actor_id is not null
     and not exists (select 1 from auth.users as u where u.id = new.actor_id) then
    raise exception 'o ator do evento não é uma conta existente'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function app.tg_audit_log_actor_exists() from public, anon, authenticated;

create trigger audit_log_actor_exists
  before insert on public.audit_log
  for each row execute function app.tg_audit_log_actor_exists();
