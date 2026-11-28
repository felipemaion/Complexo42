-- Medalha da casa visível aos membros (issue #303, ADR 0014 revisão de 28/11): `public.member_houses` devolve a quem é
-- membro ativo SÓ o id e a chave da casa ACEITA e vigente de pessoas ativas. A RLS de `house_members` não muda (só a
-- própria pessoa e a coordenação leem a tabela): é a função, com o corte dentro, que abre este único dado. Nada de
-- vínculo, datas, forma de entrada, resultado do questionário nem totem.

create or replace function public.member_houses(p_profiles uuid[])
returns table (profile_id uuid, house_key text)
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
    select h.profile_id, h.house_key
    from public.house_members as h
    where h.profile_id = any (p_profiles)
      and h.accepted_at is not null
      and h.left_at is null
      and app.is_active_profile(h.profile_id);
end;
$$;

comment on function public.member_houses(uuid[]) is
  'A chave da casa aceita e vigente (só id e chave) de pessoas ativas, a quem é membro ativo (ADR 0014, #303). Nada de vínculo, datas nem resultado.';

revoke execute on function public.member_houses(uuid[]) from public, anon;
grant execute on function public.member_houses(uuid[]) to authenticated;
