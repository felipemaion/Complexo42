-- Medalha do totem visível a todo membro (issue #303, ADR 0014 revisão de 28/11). O totem segue CIFRADO no banco
-- (ADR 0003, AES-GCM com AAD `questionnaire_results.totem_enc.<id da pessoa>`): quem o decifra é o servidor do app, com a
-- chave dele, e o navegador só recebe o código. Esta função é a única porta nova e o recorte é o contrato:
--  - devolve `(profile_id, totem_enc)` e NADA mais: sem notas dos eixos, respostas, assinatura nem casa sugerida;
--  - só a quem é membro ativo (`app.is_active_member()`: liberado, termo vigente, perfil completo e casa aceita);
--  - só de pessoas ativas (`app.is_active_profile`) e com totem definido (pendente = sem linha); inclui a própria;
--  - até 200 pessoas por chamada.
-- A RLS de `questionnaire_results` NÃO muda: as linhas dos outros seguem invisíveis pela tabela, e quem chama a função
-- pela API direta obtém só o texto cifrado, que sem a chave do app não se decifra.
create or replace function public.member_totems(p_profiles uuid[])
returns table (profile_id uuid, totem_enc text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null or not app.is_active_member() then
    raise exception 'sem acesso' using errcode = 'insufficient_privilege';
  end if;
  if p_profiles is null or cardinality(p_profiles) > 200 then
    raise exception 'lista de pessoas inválida' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select r.profile_id, r.totem_enc
    from public.questionnaire_results as r
    where r.profile_id = any (p_profiles)
      and r.totem_enc is not null
      and app.is_active_profile(r.profile_id);
end;
$$;

comment on function public.member_totems(uuid[]) is
  'O totem CIFRADO (só id e valor) de pessoas ativas, a quem é membro ativo (ADR 0014, #303). Quem decifra é o servidor do app; nada de notas nem respostas.';

revoke execute on function public.member_totems(uuid[]) from public, anon;
grant execute on function public.member_totems(uuid[]) to authenticated;
