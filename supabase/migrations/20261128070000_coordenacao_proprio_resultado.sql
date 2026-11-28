-- A coordenação vê o próprio resultado na lista de resultados do questionário (issue #318).
-- Decisão do Felipe (28/11): o coordenador, nacional ou delegado, também aparece para si na lista e no filtro
-- "escolheu outra casa", e abre o próprio resultado como qualquer outro (o acesso fica registrado).
--
-- Três funções deixam de excluir quem chama, MAS só para a coordenação (`app.manages_root()` ou
-- `app.holds_questionnaire_grant()`): a RLS (`app.can_read_questionnaire_data`) já deixa qualquer membro ler o
-- PRÓPRIO resultado, e sem esta condição uma pessoa comum poderia gravar eventos de auditoria sobre si
-- (`log_questionnaire_view`) ou ler a própria linha nas funções da coordenação. A RLS continua igual.
--   - `log_questionnaire_view`: aceita alvo igual a quem chama (coordenação); a regra dos 10 minutos vale igual.
--   - `coordination_other_house_results`: a própria pessoa entra no filtro "escolheu outra casa".
--   - `coordination_chosen_houses`: a casa escolhida da própria pessoa aparece na lista.
-- A fila de análise e a resolução de pedido continuam proibindo a própria pessoa (não é desta mudança).

create or replace function public.log_questionnaire_view(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  -- Mesma resposta para alvo nulo, inexistente, de fora do escopo ou inativo: nada diz se a pessoa existe.
  if caller is null or p_target is null or not app.can_read_questionnaire_data(p_target)
     or (p_target = caller and not (app.manages_root() or app.holds_questionnaire_grant())) then
    raise exception 'sem acesso ao resultado desta pessoa' using errcode = 'insufficient_privilege';
  end if;
  -- Recarregar a página não gera outro evento: o mesmo ator e alvo, em 10 minutos, valem um só.
  if not exists (
    select 1 from public.audit_log as a
    where a.event = 'questionnaire_result_viewed' and a.actor_id = caller and a.target_id = p_target
      and a.created_at > now() - interval '10 minutes'
  ) then
    insert into public.audit_log (actor_id, event, target_id)
    values (caller, 'questionnaire_result_viewed', p_target);
  end if;
end;
$$;

comment on function public.log_questionnaire_view(uuid) is
  'Registra que quem chama abriu o resultado do alvo (ator e alvo, sem conteúdo), só para quem pode lê-lo; o próprio resultado só para a coordenação (ADR 0014, #318).';

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
      and (r.profile_id <> caller or (app.manages_root() or app.holds_questionnaire_grant()))
      and app.can_read_questionnaire_data(r.profile_id)
    order by r.created_at desc, r.profile_id
    limit least(greatest(coalesce(p_limit, 201), 1), 201);
end;
$$;

comment on function public.coordination_other_house_results(text, integer) is
  'Quem tem casa escolhida diferente da sugerida, no alcance de quem chama (a própria coordenação inclusive), das mais novas (até 201) (ADR 0016, #318).';

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
    where (p.id <> caller or (app.manages_root() or app.holds_questionnaire_grant())) and app.can_read_questionnaire_data(p.id);
end;
$$;

comment on function public.coordination_chosen_houses(uuid[]) is
  'Casa escolhida (vínculo aberto e aceito) e data, e se a troca foi da coordenação, das pessoas que quem chama pode ler, a própria coordenação inclusive (ADR 0016, #318).';

revoke execute on function public.log_questionnaire_view(uuid) from public, anon;
grant execute on function public.log_questionnaire_view(uuid) to authenticated;
revoke execute on function public.coordination_other_house_results(text, integer) from public, anon;
grant execute on function public.coordination_other_house_results(text, integer) to authenticated;
revoke execute on function public.coordination_chosen_houses(uuid[]) from public, anon;
grant execute on function public.coordination_chosen_houses(uuid[]) to authenticated;
