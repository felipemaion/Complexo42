-- Filtro "escolheu outra casa" no banco: vale para todas as pessoas do alcance de quem chama, não só
-- para a página das mais recentes. Devolve, das mais novas, quem tem resultado e casa aceita DIFERENTE
-- da sugerida (`p_house` filtra pela casa sugerida; nulo = todas), no máximo `p_limit` (1 a 201).
-- Mesmo alcance de `coordination_chosen_houses` (`can_read_questionnaire_data`: a nacional, ou o
-- delegado no escopo; pessoa ativa; nunca a si mesma). Só ids, casa sugerida e data; nada do totem.
create or replace function public.coordination_other_house_results(p_house text, p_limit integer)
returns table (profile_id uuid, house_key text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  return query
    select r.profile_id, r.house_key, r.created_at
    from public.questionnaire_results as r
    join public.house_members as h
      on h.profile_id = r.profile_id and h.left_at is null and h.accepted_at is not null
    where h.house_key <> r.house_key
      and (p_house is null or r.house_key = p_house)
      and r.profile_id <> caller
      and app.can_read_questionnaire_data(r.profile_id)
    order by r.created_at desc, r.profile_id
    limit least(greatest(coalesce(p_limit, 201), 1), 201);
end;
$$;

comment on function public.coordination_other_house_results(text, integer) is
  'Quem tem casa escolhida diferente da sugerida, no alcance de quem chama, das mais novas (até 201) (ADR 0016).';

revoke execute on function public.coordination_other_house_results(text, integer) from public, anon;
grant execute on function public.coordination_other_house_results(text, integer) to authenticated;
