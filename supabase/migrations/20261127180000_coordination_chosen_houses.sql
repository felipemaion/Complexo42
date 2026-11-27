-- Casa sugerida × casa escolhida nas telas de resultado da coordenação.
--
-- `coordination_chosen_houses(profiles)`: para cada pessoa pedida que quem chama pode ler
-- (`can_read_questionnaire_data`: a nacional, ou o delegado no escopo; nunca a si mesma), a casa do
-- vínculo aberto e aceito (nula se ainda não aceitou), quando foi escolhida e, se a casa atual veio de
-- uma troca da coordenação, quando. A casa sugerida continua em `questionnaire_results`. Só casa e
-- datas: nada do totem, das notas nem das respostas. Abrir o resultado continua sendo auditado por
-- `log_questionnaire_view`; listar não registra nada (como a lista de resultados de sempre).
create or replace function public.coordination_chosen_houses(p_profiles uuid[])
returns table (profile_id uuid, house_key text, chosen_at timestamptz, changed_by_coordination_at timestamptz)
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
  if p_profiles is null or cardinality(p_profiles) > 200 then
    raise exception 'lista de pessoas inválida' using errcode = 'invalid_parameter_value';
  end if;
  return query
    select p.id,
           h.house_key,
           h.accepted_at,
           (select max(a.created_at)
            from public.audit_log as a
            where a.event = 'house_changed' and a.reason = 'coordination'
              and a.target_id = p.id and a.created_at >= h.accepted_at)
    from (select distinct u as id from unnest(p_profiles) as u) as p
    left join public.house_members as h
      on h.profile_id = p.id and h.left_at is null and h.accepted_at is not null
    where p.id <> caller and app.can_read_questionnaire_data(p.id);
end;
$$;

comment on function public.coordination_chosen_houses(uuid[]) is
  'Casa escolhida (vínculo aberto e aceito) e data, e se a troca foi da coordenação, das pessoas que quem chama pode ler (ADR 0016).';

revoke execute on function public.coordination_chosen_houses(uuid[]) from public, anon;
grant execute on function public.coordination_chosen_houses(uuid[]) to authenticated;
