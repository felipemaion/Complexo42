-- Escolha e aceite da casa (issue #76, ADR 0008 §2 e §2.1).
--
-- Do questionário, a plataforma guarda só a casa (e a forma de entrada); as respostas nunca
-- chegam ao banco. Nenhuma tabela ou função daqui recebe resposta.
--
-- 1. `questionnaire_consents`: aceite do termo do questionário, com a versão do texto e a
--    data. Sem assinatura nem e-mail (a conta já identifica a pessoa). Só o titular lê.
-- 2. Ligação entre a casa de `config/instance.ts` e a unidade: o `id` da casa na config
--    (minúsculas, números e hífens) é o `slug` da unidade com `_` no lugar de `-`
--    (`casa-exemplo-1` ↔ `casa_exemplo_1`). O servidor confere o id contra a config; o
--    banco confere que existe a unidade de casa na região da pessoa
--    (`app.house_unit_for`). O seed e a config são conferidos juntos por
--    tests/house-units.test.ts.
-- 3. RPCs (`security definer`, só para quem está logado e ativo, e só sobre si mesmo):
--    - `record_questionnaire_consent(term_version)`;
--    - `accept_house(house_key, join_method)`: grava o vínculo de casa já aceito.

-- ---------------------------------------------------------------------------------------
-- 1. questionnaire_consents
-- ---------------------------------------------------------------------------------------
create table public.questionnaire_consents (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Versão do termo, vinda do arquivo do questionário (`consentTermVersion`).
  term_version text not null
    constraint questionnaire_consents_term_version_format
    check (term_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  consented_at timestamptz not null default now(),
  constraint questionnaire_consents_pkey primary key (profile_id, term_version)
);

comment on table public.questionnaire_consents is
  'Aceite do termo do questionário das casas: versão e data (ADR 0008 §2.1). Nunca as respostas.';

alter table public.questionnaire_consents enable row level security;

revoke all on public.questionnaire_consents from anon, authenticated;
grant select on public.questionnaire_consents to authenticated;

-- Só o titular lê os próprios aceites. Gravar é só pela função abaixo (sem grant de escrita).
create policy questionnaire_consents_select on public.questionnaire_consents
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------
-- 2. Qual unidade é a casa `key` para a pessoa
-- ---------------------------------------------------------------------------------------
-- A âncora é o vínculo aberto da pessoa no eixo `team` (a unidade do estado, uma região ou
-- uma equipe). Só valem casas ativas abaixo do estado dessa âncora:
--   a) a casa filha do ancestral mais próximo da âncora (ela inclusive): quem está numa
--      equipe da região ABC fica com a casa do ABC;
--   b) sem isso, a única casa com esse slug abaixo da âncora: quem ainda está só no estado
--      fica com a casa, se só uma região do estado a oferece.
-- Nenhuma ou mais de uma: devolve nulo (a coordenação precisa definir a região antes).
create or replace function app.house_unit_for(p_profile uuid, p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  house_slug text;
  anchor_path extensions.ltree;
  state_path extensions.ltree;
  found uuid;
  found_count integer;
begin
  if p_key is null or p_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_key) > 63 then
    return null;
  end if;
  house_slug := replace(p_key, '-', '_');

  select u.path into anchor_path
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  where m.profile_id = p_profile and m.left_at is null and m.axis = 'team';
  if anchor_path is null then
    return null;
  end if;

  select s.path into state_path
  from public.units as s
  where s.state_code is not null and s.path operator(extensions.@>) anchor_path;
  if state_path is null then
    return null;
  end if;

  select h.id into found
  from public.units as h
  join public.unit_types as t on t.id = h.type_id
  join public.units as p on p.id = h.parent_id
  where t.membership_axis = 'house'
    and h.status = 'active'
    and h.slug = house_slug
    and p.path operator(extensions.@>) anchor_path
    and p.path operator(extensions.<@) state_path
  order by extensions.nlevel(p.path) desc
  limit 1;
  if found is not null then
    return found;
  end if;

  select count(*)::integer, min(h.id::text)::uuid into found_count, found
  from public.units as h
  join public.unit_types as t on t.id = h.type_id
  where t.membership_axis = 'house'
    and h.status = 'active'
    and h.slug = house_slug
    and h.path operator(extensions.<@) anchor_path;
  return case when found_count = 1 then found end;
end;
$$;

comment on function app.house_unit_for(uuid, text) is
  'Unidade da casa `key` (id da config) na região da pessoa, ou nulo se não houver uma só.';

revoke execute on function app.house_unit_for(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------------------
-- Aceite do termo antes do questionário. Grava a versão e a data uma vez por versão (repetir
-- devolve a data do primeiro aceite). Só quem está liberado e ativo.
create or replace function public.record_questionnaire_consent(p_term_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  at timestamptz;
begin
  if caller is null or not app.is_active_member() then
    raise exception 'só quem está ativo responde ao questionário'
      using errcode = 'insufficient_privilege';
  end if;
  if p_term_version is null or p_term_version !~ '^[A-Za-z0-9._-]{1,32}$' then
    raise exception 'versão do termo em formato inválido' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.questionnaire_consents (profile_id, term_version)
  values (caller, p_term_version)
  on conflict (profile_id, term_version) do nothing;

  select c.consented_at into at
  from public.questionnaire_consents as c
  where c.profile_id = caller and c.term_version = p_term_version;
  return at;
end;
$$;

comment on function public.record_questionnaire_consent(text) is
  'Grava o aceite do termo do questionário (versão e data) de quem chama. Nunca respostas.';

-- Escolha e aceite da casa, de uma vez: a apresentação da casa é mostrada antes, no
-- aparelho, e só o "aceitar" chega aqui. Regras:
-- - só quem está liberado e ativo, e só para si mesmo (não há parâmetro de pessoa);
-- - `join_method = 'questionnaire'` exige o termo aceito antes; quem recusou o termo entra
--   com `self`;
-- - a casa precisa existir na região da pessoa (`app.house_unit_for`);
-- - com uma casa já aceita: a mesma casa devolve o mesmo vínculo (clique repetido); outra
--   casa é recusada (trocar de casa é com a coordenação);
-- - um vínculo de casa aberto e ainda sem aceite é encerrado e dá lugar ao novo.
-- Devolve o id da unidade da casa.
create or replace function public.accept_house(p_house_key text, p_join_method text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  house uuid;
  open_unit uuid;
  open_accepted timestamptz;
begin
  if caller is null or not app.is_active_member() then
    raise exception 'só quem está ativo escolhe a casa' using errcode = 'insufficient_privilege';
  end if;
  if p_join_method is null or p_join_method not in ('self', 'questionnaire') then
    raise exception 'forma de entrada inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_join_method = 'questionnaire'
     and not exists (select 1 from public.questionnaire_consents as c where c.profile_id = caller) then
    raise exception 'o questionário exige o termo aceito' using errcode = 'invalid_parameter_value';
  end if;

  -- Trava o perfil: dois cliques simultâneos não criam dois vínculos (o índice também barra).
  perform 1 from public.profiles as p where p.id = caller for update;

  house := app.house_unit_for(caller, p_house_key);
  if house is null then
    raise exception 'casa indisponível para esta pessoa' using errcode = 'no_data_found';
  end if;

  select m.unit_id, m.accepted_at into open_unit, open_accepted
  from public.unit_members as m
  where m.profile_id = caller and m.left_at is null and m.axis = 'house';

  if open_accepted is not null then
    if open_unit = house then
      return house;
    end if;
    raise exception 'a casa já foi aceita' using errcode = 'unique_violation';
  end if;

  if open_unit is not null then
    update public.unit_members
    set left_at = now()
    where profile_id = caller and left_at is null and axis = 'house';
  end if;

  insert into public.unit_members (unit_id, profile_id, join_method, accepted_at)
  values (house, caller, p_join_method, now());
  return house;
end;
$$;

comment on function public.accept_house(text, text) is
  'Quem chama aceita a casa `house_key` (id da config) na sua região; guarda só a casa e a forma.';

revoke execute on function
  public.record_questionnaire_consent(text),
  public.accept_house(text, text)
from public, anon;

grant execute on function
  public.record_questionnaire_consent(text),
  public.accept_house(text, text)
to authenticated;
