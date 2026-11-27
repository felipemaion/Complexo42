-- Perfil médio da casa (ADR 0014): as notas por eixo existem só CIFRADAS (ADR 0003), então o banco não calcula a média.
-- Esta função devolve, SÓ ao servidor do app, as notas cifradas dos membros da casa; o servidor decifra, tira a média dos
-- eixos da casa (sem totem), descarta ids e notas e entrega ao navegador apenas n e médias arredondadas, com n mínimo.
-- Nada em claro no banco e sem `service_role`: como as outras escritas e leituras sensíveis do questionário, só responde com a
-- assinatura HMAC do servidor (chave que o navegador não tem), ligada a quem chama e à casa, válida por 5 minutos.
-- `profile_id` volta porque é o AAD para decifrar (`questionnaire_results.scores_enc.<profile_id>`); a lista fica no servidor.
create or replace function public.house_member_scores_enc(p_house_key text, p_issued_at bigint, p_signature text)
returns table (profile_id uuid, scores_enc text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  perform app.verify_server_signature(format('house_scores|%s|%s|%s', caller, p_house_key, p_issued_at), p_issued_at, p_signature);
  -- Quem está na entrada (liberada, ainda sem casa) compara casas; a espera e o bloqueio não.
  if not app.is_onboarding_member() then
    raise exception 'só quem está liberado compara casas' using errcode = 'insufficient_privilege';
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;
  return query
  select r.profile_id, r.scores_enc
  from public.questionnaire_results as r
  join public.house_members as m
    on m.profile_id = r.profile_id and m.house_key = p_house_key and m.left_at is null and m.accepted_at is not null
  join public.profiles as p on p.id = r.profile_id and p.access_status = 'active'
  where r.scores_enc is not null;
end;
$$;

comment on function public.house_member_scores_enc(text, bigint, text) is
  'Notas cifradas dos membros (vínculo aberto e aceito, ativos, com notas) de uma casa, só com a assinatura do servidor (5 min, ligada a quem chama e à casa). O servidor decifra e entrega só n e médias (ADR 0014).';

revoke execute on function public.house_member_scores_enc(text, bigint, text) from public, anon;
grant execute on function public.house_member_scores_enc(text, bigint, text) to authenticated;
