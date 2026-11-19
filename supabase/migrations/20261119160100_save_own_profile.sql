-- Gravação do perfil e do contato só pelo servidor (issue #12; achado da revisão do #112).
--
-- Até aqui o titular gravava `profiles` e `profile_contacts` direto pela API, por grant de
-- coluna. Quem chamasse o PostgREST com o próprio JWT podia gravar um `whatsapp_hmac` e
-- valores `*_enc` quaisquer no próprio perfil, sem passar pelo servidor que valida o texto
-- (Zod), cifra (src/server/crypto) e calcula o HMAC.
--
-- 1. Sem grant de INSERT/UPDATE em `profiles` e `profile_contacts` para `authenticated`. As
--    políticas de INSERT/UPDATE continuam (segunda barreira, se um grant voltar por engano).
-- 2. `public.save_own_profile(...)`, `security definer`: a server action do formulário chama
--    com os valores JÁ cifrados e o HMAC calculado no servidor, com o JWT da pessoa (R14).
--    Ela grava só a linha de quem chama (`auth.uid()`), só se `app.can_edit_profile` deixar
--    (R15), e confere o formato de cada valor antes de gravar.
-- 3. WhatsApp repetido (`whatsapp_hmac` único) devolve o erro 23505 com mensagem fixa, sem o
--    detalhe do Postgres (que traria o HMAC).
-- 4. `consent_version` só é gravado na criação do perfil. Mudar a versão (novo aceite) é do
--    fluxo do termo (#11), não deste formulário.
--
-- Risco residual (aceito e documentado no PR): a pessoa ainda pode chamar a função direto,
-- com o próprio JWT, e gravar no PRÓPRIO perfil um valor no formato certo mas que não decifra
-- (ou um HMAC que não é o do número dela, ou um distrito fora da lista). Não alcança a linha
-- de mais ninguém e não revela nada: o HMAC só é calculável com a chave do servidor, então
-- não dá para testar números alheios. O efeito possível é estragar o próprio cadastro ou
-- driblar a regra "um WhatsApp, um cadastro" para o próprio número; a leitura do servidor
-- trata valor que não decifra como erro.

create or replace function public.save_own_profile(
  p_display_name_enc text,
  p_municipality_code integer,
  p_district text,
  p_consent_version text,
  p_whatsapp_enc text,
  p_whatsapp_hmac text,
  p_social_links_enc text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
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
  if p_consent_version is null or p_consent_version !~ '^[A-Za-z0-9._-]{1,32}$' then
    raise exception 'versão do termo em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_municipality_code is null then
    raise exception 'município obrigatório' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.profiles (id, display_name_enc, municipality_code, district, consent_version)
  values (caller, p_display_name_enc, p_municipality_code, p_district, p_consent_version)
  on conflict (id) do update
    set display_name_enc = excluded.display_name_enc,
        municipality_code = excluded.municipality_code,
        district = excluded.district;

  begin
    insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac, social_links_enc)
    values (caller, p_whatsapp_enc, p_whatsapp_hmac, p_social_links_enc)
    on conflict (profile_id) do update
      set whatsapp_enc = excluded.whatsapp_enc,
          whatsapp_hmac = excluded.whatsapp_hmac,
          social_links_enc = excluded.social_links_enc;
  exception
    when unique_violation then
      -- Sem o DETAIL do Postgres (traria o HMAC) e sem dizer de quem é o número.
      raise exception 'WhatsApp já cadastrado' using errcode = 'unique_violation';
  end;
end;
$$;

comment on function public.save_own_profile(text, integer, text, text, text, text, text) is
  'Única escrita de perfil e contato pela API: só a própria linha, valores já cifrados pelo servidor.';

revoke execute on function public.save_own_profile(text, integer, text, text, text, text, text)
  from public, anon;
grant execute on function public.save_own_profile(text, integer, text, text, text, text, text)
  to authenticated;

-- Revogar no nível da tabela também revoga os grants de coluna (INSERT/UPDATE).
revoke insert, update on public.profiles, public.profile_contacts from authenticated;
