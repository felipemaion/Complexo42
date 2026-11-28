-- Aprovar uma sugestão cujo nome já é de uma habilidade mesclada ou renomeada (#25, acompanhamento).
--
-- Mesclar A em B desativa A e passa o nome de A para os sinônimos de B; renomear também deixa o nome antigo como
-- sinônimo. Uma sugestão que já estava aberta com esse nome, ao ser aprovada, antes reativava A (desfazendo a
-- mesclagem) ou criava uma habilidade repetida. Agora: se uma habilidade ATIVA tem esse nome ou esse sinônimo, é
-- ela que a pessoa recebe, e nada é criado nem reativado. Só sem nenhuma ativa o nome de uma desativada (que
-- ninguém mesclou) é reativado, como antes; senão cria.
create or replace function public.decide_skill_suggestion(p_id uuid, p_approve boolean, p_category text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  sug public.skill_suggestions;
  cat text := btrim(p_category);
  norm text;
  skill uuid;
  was_active boolean;
begin
  if caller is null or not app.manages_root() then
    raise exception 'só a coordenação nacional decide' using errcode = 'insufficient_privilege';
  end if;
  if p_approve is null or (p_approve and not app.valid_skill_name(cat)) then
    raise exception 'decisão inválida' using errcode = 'invalid_parameter_value';
  end if;

  select * into sug from public.skill_suggestions as q where q.id = p_id and q.status = 'open' for update;
  if not found then
    raise exception 'sugestão não encontrada ou já decidida' using errcode = 'no_data_found';
  end if;

  if p_approve then
    norm := app.norm_text(sug.name);
    -- 1) Uma ativa com o mesmo nome (primeiro) ou com o nome como sinônimo (a que recebeu uma mesclagem).
    select s.id into skill
    from public.skills as s
    where s.active and (app.norm_text(s.name) = norm or s.aliases @> array[norm])
    order by (app.norm_text(s.name) = norm) desc, s.name
    limit 1;

    if skill is null then
      -- 2) Cria. O índice único do nome normalizado fecha a corrida: se outra aprovação criou a mesma, usa-se a dela.
      insert into public.skills (name, category) values (sug.name, cat)
      on conflict ((app.norm_text(name))) do nothing
      returning id into skill;
      if skill is null then
        select s.id, s.active into skill, was_active from public.skills as s where app.norm_text(s.name) = norm;
        -- Casou com uma desativada que ninguém mesclou: reativa antes de marcar para a pessoa, e registra.
        if not was_active then
          update public.skills set active = true where id = skill;
          insert into public.audit_log (actor_id, event) values (caller, 'skill_reactivated');
        end if;
      end if;
    end if;

    perform 1 from public.profiles as p where p.id = sug.profile_id for update;
    if (select count(*) from public.profile_skills as ps where ps.profile_id = sug.profile_id) < app.skills_per_person_max() then
      insert into public.profile_skills (profile_id, skill_id) values (sug.profile_id, skill) on conflict do nothing;
    end if;
  end if;

  update public.skill_suggestions
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = caller, decided_at = now()
  where id = p_id;

  insert into public.audit_log (actor_id, event, target_id) values (caller, 'skill_suggestion_decided', sug.profile_id);
end;
$$;

comment on function public.decide_skill_suggestion(uuid, boolean, text) is
  'A coordenação nacional aprova (usa a habilidade ativa de mesmo nome ou sinônimo, reativa a desativada de mesmo nome, ou cria) ou rejeita a sugestão; audita (#15, #25).';
