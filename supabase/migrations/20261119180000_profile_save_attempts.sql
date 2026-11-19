-- Limite de tentativas no aviso de WhatsApp repetido (issue #127; achado L1 da revisão do #125).
--
-- Sem limite, quem está logado testa números um a um em `save_own_profile` e descobre quais
-- já estão na plataforma (o aviso "WhatsApp já cadastrado" é um oráculo). Agora:
--
-- 1. `app.profile_save_attempts` guarda só (pessoa, momento) de cada salvamento que terminou
--    em WhatsApp repetido. Nada do número nem do HMAC. Fica no banco, e não na memória do
--    servidor, porque vale para qualquer número de processos e sobrevive a um reinício.
--    RLS ligada, política que nega tudo e nenhum grant para a API: só a função escreve e lê.
-- 2. Com 5 desses registros na última hora, a função recusa ANTES de gravar qualquer coisa,
--    com o erro `PT429` e a mensagem fixa `too_many_attempts` (o PostgREST responde 429). A
--    recusa não toca o índice único: vale igual para número livre ou já usado, então o próprio
--    limite não vira oráculo.
-- 3. Para o registro da tentativa sobreviver, o WhatsApp repetido deixa de ser um erro (que
--    desfaria a transação inteira, registro incluído) e vira retorno: a função devolve
--    `duplicate_whatsapp` ou `saved`. O bloco interno desfaz o perfil e o contato daquela
--    chamada, como antes: com o WhatsApp repetido nada muda no cadastro.
-- 4. Limpeza oportunista: ao registrar uma tentativa, apaga as de mais de uma hora (de todos).
--
-- Mudar o tipo de retorno exige recriar a função (DROP + CREATE), com os mesmos grants.

create table app.profile_save_attempts (
  profile_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

comment on table app.profile_save_attempts is
  'Salvamentos de perfil que terminaram em WhatsApp repetido (#127). Só save_own_profile usa.';

create index profile_save_attempts_profile_idx
  on app.profile_save_attempts (profile_id, attempted_at);
create index profile_save_attempts_at_idx
  on app.profile_save_attempts (attempted_at);

alter table app.profile_save_attempts enable row level security;

revoke all on app.profile_save_attempts from public, anon, authenticated, service_role;

-- Nenhum grant para a API. A política só documenta a regra (R5): mesmo com um grant por
-- engano, nenhuma linha apareceria nem seria gravada.
create policy profile_save_attempts_no_api_access on app.profile_save_attempts
  for all to anon, authenticated
  using (false)
  with check (false);

drop function public.save_own_profile(text, integer, text, text, text, text);

create function public.save_own_profile(
  p_display_name_enc text,
  p_municipality_code integer,
  p_district text,
  p_whatsapp_enc text,
  p_whatsapp_hmac text,
  p_social_links_enc text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  -- Até 5 salvamentos com WhatsApp repetido por pessoa, por hora (#127).
  max_duplicates constant integer := 5;
  duplicate_window constant interval := interval '1 hour';
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_edit_profile(caller) then
    raise exception 'sem permissão para editar este perfil' using errcode = 'insufficient_privilege';
  end if;

  -- Formato antes de tocar as tabelas (os CHECKs das colunas repetem, como segunda barreira).
  if p_display_name_enc is null or not app.is_encrypted_value(p_display_name_enc, 512) then
    raise exception 'nome em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_whatsapp_enc is null or not app.is_encrypted_value(p_whatsapp_enc, 128) then
    raise exception 'WhatsApp em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_whatsapp_hmac is null or p_whatsapp_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'HMAC em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_social_links_enc is not null and not app.is_encrypted_value(p_social_links_enc, 4096) then
    raise exception 'redes em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_municipality_code is null then
    raise exception 'município obrigatório' using errcode = 'invalid_parameter_value';
  end if;

  -- Uma chamada por vez por pessoa: várias em paralelo não passam juntas do limite.
  perform pg_advisory_xact_lock(hashtextextended('save_own_profile:' || caller::text, 0));

  -- O limite vem antes de qualquer gravação e não consulta o índice único (#127).
  if (select count(*) from app.profile_save_attempts as a
      where a.profile_id = caller and a.attempted_at > now() - duplicate_window) >= max_duplicates then
    raise exception 'too_many_attempts' using errcode = 'PT429';
  end if;

  begin
    insert into public.profiles (id, display_name_enc, municipality_code, district, consent_version)
    values (caller, p_display_name_enc, p_municipality_code, p_district, 'none')
    on conflict (id) do update
      set display_name_enc = excluded.display_name_enc,
          municipality_code = excluded.municipality_code,
          district = excluded.district;

    insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac, social_links_enc)
    values (caller, p_whatsapp_enc, p_whatsapp_hmac, p_social_links_enc)
    on conflict (profile_id) do update
      set whatsapp_enc = excluded.whatsapp_enc,
          whatsapp_hmac = excluded.whatsapp_hmac,
          social_links_enc = excluded.social_links_enc;
  exception
    when unique_violation then
      -- O único índice único que o bloco pode violar é o de `whatsapp_hmac` (o de `profiles.id`
      -- e o de `profile_contacts.profile_id` caem no `on conflict`).
      -- O bloco desfez o perfil e o contato desta chamada. Fica só o registro da tentativa,
      -- sem o HMAC e sem dizer de quem é o número.
      insert into app.profile_save_attempts (profile_id) values (caller);
      delete from app.profile_save_attempts as a where a.attempted_at <= now() - duplicate_window;
      return 'duplicate_whatsapp';
  end;
  return 'saved';
end;
$$;

comment on function public.save_own_profile(text, integer, text, text, text, text) is
  'Única escrita de perfil e contato pela API: só a própria linha, valores já cifrados pelo servidor. '
  'Devolve saved ou duplicate_whatsapp; recusa com PT429 depois de 5 repetidos na hora (#127).';

revoke execute on function public.save_own_profile(text, integer, text, text, text, text)
  from public, anon;
grant execute on function public.save_own_profile(text, integer, text, text, text, text)
  to authenticated;
