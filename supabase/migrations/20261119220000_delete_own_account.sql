-- "Excluir minha conta" (issue #18, LGPD art. 18, VI): exclusão real, feita pela própria pessoa.
--
-- 1. `public.delete_own_account()` (`security definer`, dono `postgres`), chamada pelo servidor
--    com o JWT de quem está logado (R14). Não recebe parâmetro: só apaga `auth.uid()`. Por que
--    no banco e não pela API de admin do GoTrue: a API de admin exige a chave `service_role`
--    no servidor do app, que hoje não a tem (R6 e o princípio de não guardar segredo com
--    acesso total onde não precisa). Aqui, o máximo que um JWT válido consegue é apagar a
--    PRÓPRIA conta. O `postgres` tem DELETE em `auth.users` no Supabase local e no
--    auto-hospedado (mesma imagem `supabase/postgres`); as tabelas do GoTrue que dependem do
--    usuário (sessões, identidades, tokens, MFA) têm FK `on delete cascade`.
-- 2. Reautenticação recente, conferida AQUI (não só na tela): o login mais recente da sessão
--    (`amr[].timestamp` do JWT, assinado pelo GoTrue e que não muda na renovação do token)
--    precisa ter no máximo 10 minutos. Senão, erro `PT401` (`reauth_required`). Um cookie de
--    sessão roubado ou um aparelho esquecido aberto não bastam para apagar a conta.
-- 3. O que apaga: `auth.users` e, em cascata, `profiles`, `profile_contacts`, `unit_members`
--    e `role_assignments` da pessoa, `access_waitlist_hmac`, `questionnaire_consents`,
--    `app.profile_save_attempts`, sessões e identidades. Também o rastro que o próprio GoTrue
--    deixa com o e-mail e o IP (`auth.audit_log_entries`) e os `auth.flow_state` (PKCE).
-- 4. Dados de OUTRAS pessoas que citam a conta apagada perdem só a referência:
--    `role_assignments.granted_by` e `unit_members.ended_by` viram nulos (FK `set null`).
--    O trigger de `ended_by` devolvia o valor antigo em qualquer UPDATE e quebrava a cascata;
--    agora aceita o nulo quando o perfil citado não existe mais (só a cascata faz isso: a API
--    não tem grant de escrita em `ended_by`).
-- 5. `audit_log` continua só-inserção (o trigger não muda). Os ids da conta apagada ficam nos
--    eventos antigos como uuid solto (sem FK, por desenho): sem `auth.users` e sem perfil,
--    nada no banco liga esse uuid a uma pessoa. A função grava `account_deleted` (ator e alvo
--    = o id apagado, sem nenhum dado pessoal), que também serve para reaplicar a exclusão
--    se um backup antigo for restaurado.
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
  -- Segundos desde o login mais recente da sessão (null sem `amr`).
  select extract(epoch from now())::bigint - max((m ->> 'timestamp')::bigint)
  from jsonb_array_elements(
    case
      when jsonb_typeof((select auth.jwt()) -> 'amr') = 'array' then (select auth.jwt()) -> 'amr'
      else '[]'::jsonb
    end
  ) as m
  where jsonb_typeof(m -> 'timestamp') = 'number';
$$;

comment on function app.auth_age_seconds() is
  'Segundos desde o último login da sessão (amr do JWT). Usada pela exclusão de conta (#18).';

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
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  age := app.auth_age_seconds();
  if age is null or age > reauth_window then
    raise exception 'entre de novo para confirmar a exclusão'
      using errcode = 'PT401', hint = 'reauth_required';
  end if;

  -- Uma exclusão por vez para a mesma conta.
  perform pg_advisory_xact_lock(hashtextextended('delete_own_account:' || caller::text, 0));
  if not exists (select 1 from auth.users as u where u.id = caller) then
    raise exception 'conta não encontrada' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'account_deleted', caller);

  -- Rastro do GoTrue com e-mail e IP (sem FK para auth.users).
  delete from auth.audit_log_entries as e
  where e.payload ->> 'actor_id' = caller::text
     or e.payload -> 'traits' ->> 'user_id' = caller::text;
  delete from auth.flow_state as f where f.user_id = caller;

  -- O resto vai em cascata (ver o cabeçalho).
  delete from auth.users as u where u.id = caller;
end;
$$;

comment on function public.delete_own_account() is
  'Exclui a conta de quem chama (#18): exige login nos últimos 10 minutos; grava account_deleted.';

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
