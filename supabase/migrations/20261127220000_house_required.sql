-- Casa antes de tudo (ADR 0017, guard): salvar o perfil exige a casa aceita de quem está liberado. A entrada (ver as
-- casas, termo do questionário, questionário, aceitar a casa) segue com `is_onboarding_member`, que não exige casa.
-- (A leitura de dados pelo predicado `is_active_member` não passa a exigir a casa neste PR: o portão das páginas
-- cobre a UI; endurecer o predicado mexe em todas as fixtures de RLS e fica para PR próprio.)

create or replace function public.save_own_profile(
  p_display_name_enc text,
  p_municipality_code integer,
  p_district_code integer,
  p_whatsapp_enc text,
  p_whatsapp_hmac text,
  p_social_links_enc text default null,
  p_neighborhood_enc text default null
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
  -- Sem o aceite da versão vigente do termo, nada é gravado (#11).
  if not exists (
    select 1 from public.consent_acceptances as c
    where c.user_id = caller and c.version = app.current_consent_version()
  ) then
    raise exception 'consent_required' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_edit_profile(caller) then
    raise exception 'sem permissão para editar este perfil' using errcode = 'insufficient_privilege';
  end if;
  -- Casa antes do perfil (ADR 0017): quem está liberado e ainda não tem a casa aceita não salva o perfil. Quem ainda
  -- não está liberado (espera, sem linha) segue o caminho de hoje: não tem como aceitar uma casa.
  if exists (select 1 from public.profiles as p where p.id = caller and p.access_status = 'active')
     and not exists (
       select 1 from public.house_members as h
       where h.profile_id = caller and h.left_at is null and h.accepted_at is not null
     ) then
    raise exception 'house_required' using errcode = 'insufficient_privilege';
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
  if p_neighborhood_enc is not null and not app.is_encrypted_value(p_neighborhood_enc, 512) then
    raise exception 'bairro em formato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_municipality_code is null then
    raise exception 'município obrigatório' using errcode = 'invalid_parameter_value';
  end if;
  -- O distrito tem de ser do município. Município com um distrito só (a sede) não tem escolha:
  -- o distrito fica nulo. A chave estrangeira composta do perfil repete a primeira regra.
  if p_district_code is not null then
    if not exists (
      select 1 from public.districts as d
      where d.code = p_district_code and d.municipality_code = p_municipality_code
    ) then
      raise exception 'district_mismatch' using errcode = 'PT422';
    end if;
    if (select count(*) from public.districts as d where d.municipality_code = p_municipality_code) < 2 then
      p_district_code := null;
    end if;
  end if;

  -- Uma chamada por vez por pessoa: várias em paralelo não passam juntas do limite.
  perform pg_advisory_xact_lock(hashtextextended('save_own_profile:' || caller::text, 0));

  -- O limite vem antes de qualquer gravação e não consulta o índice único (#127).
  if (select count(*) from app.profile_save_attempts as a
      where a.profile_id = caller and a.attempted_at > now() - duplicate_window) >= max_duplicates then
    raise exception 'too_many_attempts' using errcode = 'PT429';
  end if;

  begin
    insert into public.profiles (id, display_name_enc, municipality_code, district_code, neighborhood_enc, consent_version, profile_completed_at)
    values (caller, p_display_name_enc, p_municipality_code, p_district_code, p_neighborhood_enc, app.current_consent_version(), now())
    on conflict (id) do update
      set display_name_enc = excluded.display_name_enc,
          municipality_code = excluded.municipality_code,
          district_code = excluded.district_code,
          neighborhood_enc = excluded.neighborhood_enc,
          -- Perfil incompleto (ADR 0017) é completado aqui; o já completo mantém o que tem.
          -- Perfil incompleto: o termo exigido agora (excluded), nunca um valor velho da linha; completo: mantém.
          consent_version = case when public.profiles.profile_completed_at is null then excluded.consent_version else public.profiles.consent_version end,
          profile_completed_at = coalesce(public.profiles.profile_completed_at, now());

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

comment on function public.save_own_profile(text, integer, integer, text, text, text, text) is
  'Única escrita de perfil e contato pela API: só a própria linha, valores já cifrados pelo servidor. '
  'Completa o perfil incompleto criado no primeiro login e exige a casa aceita de quem está liberado (ADR 0017). '
  'Devolve saved ou duplicate_whatsapp; recusa com PT429 depois de 5 repetidos na hora (#127) e '
  'com PT422 se o distrito não é do município (#175).';
