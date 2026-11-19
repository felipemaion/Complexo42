-- Escolha e aceite da casa (issue #76, ADR 0008 §2 e §2.1).
--
-- Do questionário, a plataforma guarda só a casa (e a forma de entrada); as respostas nunca
-- chegam ao banco. Nenhuma tabela ou função daqui recebe resposta.
--
-- 1. `app.questionnaire_term_versions`: as versões do termo do questionário que existem.
--    Entram só por migration ou seed (sem grant para a API). O termo aceito precisa ser uma
--    delas, e assim ninguém cria linhas à vontade em `questionnaire_consents`.
-- 2. `questionnaire_consents`: aceite do termo, com a versão e a data. Sem assinatura nem
--    e-mail (a conta já identifica a pessoa). Só o titular lê.
-- 3. `unit_members.consent_version` (a versão do termo com que a casa foi aceita pelo
--    questionário; nula em `self`) e `unit_members.ended_by` (quem encerrou o vínculo,
--    gravado por trigger). Vínculo de casa encerrado pela coordenação não deixa a pessoa
--    voltar sozinha: a volta é decisão da coordenação.
-- 4. Ligação entre a casa de `config/instance.ts` e a unidade: o `id` da casa na config
--    (minúsculas, números e hífens) é o `slug` da unidade com `_` no lugar de `-`
--    (`casa-exemplo-1` ↔ `casa_exemplo_1`). O servidor confere o id contra a config; o
--    banco confere que existe a casa na região da pessoa (`app.house_unit_for`). O seed e a
--    config são conferidos juntos por tests/house-units.test.ts.
-- 5. RPCs (`security definer`, só para quem está logado e ativo, e só sobre si mesmo), com
--    registro no audit_log (`questionnaire_consented`, `house_accepted`):
--    - `record_questionnaire_consent(term_version)`;
--    - `accept_house(house_key, join_method, term_version)`: grava o vínculo de casa aceito.
--
-- Códigos de erro próprios (o servidor traduz em mensagem):
--   C7601  a região da pessoa ainda não foi definida (sem vínculo de equipe numa região);
--   C7602  a coordenação encerrou o vínculo de casa da pessoa (a volta é com ela).

-- ---------------------------------------------------------------------------------------
-- 1. Versões do termo
-- ---------------------------------------------------------------------------------------
create table app.questionnaire_term_versions (
  version text primary key
    constraint questionnaire_term_versions_format check (version ~ '^[A-Za-z0-9._-]{1,32}$'),
  created_at timestamptz not null default now()
);

comment on table app.questionnaire_term_versions is
  'Versões do termo do questionário (ADR 0008 §2.1). Só migration ou seed; sem acesso pela API.';

alter table app.questionnaire_term_versions enable row level security;
revoke all on app.questionnaire_term_versions from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. questionnaire_consents
-- ---------------------------------------------------------------------------------------
create table public.questionnaire_consents (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  term_version text not null references app.questionnaire_term_versions (version),
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
-- 3. unit_members: versão do termo e quem encerrou
-- ---------------------------------------------------------------------------------------
alter table public.unit_members
  add column consent_version text references app.questionnaire_term_versions (version),
  add column ended_by uuid references public.profiles (id) on delete set null,
  -- A versão do termo só existe (e é obrigatória) na casa aceita pelo questionário.
  add constraint unit_members_consent_version_only_questionnaire
    check ((consent_version is not null) = (join_method is not distinct from 'questionnaire'));

comment on column public.unit_members.consent_version is
  'Casa pelo questionário: a versão do termo aceito. Nula em self e no eixo team.';
comment on column public.unit_members.ended_by is
  'Quem encerrou o vínculo (auth.uid() de quem gravou left_at; nulo: operação direta no banco).';

-- Quem encerra é quem grava `left_at`; o valor enviado é ignorado.
create or replace function app.tg_unit_members_set_ended_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.left_at is null then
    new.ended_by := null;
  elsif tg_op = 'INSERT' or old.left_at is null then
    new.ended_by := (select auth.uid());
  else
    new.ended_by := old.ended_by;
  end if;
  return new;
end;
$$;

create trigger unit_members_set_ended_by
  before insert or update of left_at, ended_by on public.unit_members
  for each row execute function app.tg_unit_members_set_ended_by();

revoke execute on function app.tg_unit_members_set_ended_by() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- audit_log: os dois eventos novos
-- ---------------------------------------------------------------------------------------
-- `house_accepted`: actor = a pessoa, target = a unidade da casa, reason = a forma de
-- entrada (self ou questionnaire), term_version = a versão do termo (só no questionário).
-- `questionnaire_consented`: actor = a pessoa, term_version = a versão. Nunca respostas.
alter table public.audit_log
  add column term_version text
    constraint audit_log_term_version_format check (term_version ~ '^[A-Za-z0-9._-]{1,32}$');

alter table public.audit_log
  drop constraint audit_log_event_check,
  add constraint audit_log_event_check check (event in (
    'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
    'export', 'badge_granted', 'badge_revoked', 'submission_approved',
    'submission_rejected', 'points_adjusted', 'account_deleted',
    'allowlist_imported', 'access_granted', 'access_blocked',
    'house_accepted', 'questionnaire_consented'
  )),
  drop constraint audit_log_reason_check,
  drop constraint audit_log_reason_only_for_access,
  add constraint audit_log_reason_by_event check (
    case
      when event in ('access_granted', 'access_blocked') then reason in ('manual', 'import')
      when event = 'house_accepted' then reason in ('self', 'questionnaire')
      else reason is null
    end
  ),
  add constraint audit_log_term_version_by_event check (
    case
      when event = 'questionnaire_consented' then term_version is not null
      when event = 'house_accepted' then (term_version is not null) = (reason = 'questionnaire')
      else term_version is null
    end
  );

-- ---------------------------------------------------------------------------------------
-- 4. Região e casa da pessoa
-- ---------------------------------------------------------------------------------------
-- A âncora é o vínculo aberto da pessoa no eixo `team`, e só vale se estiver abaixo de uma
-- unidade de estado (numa região ou numa equipe). Quem ainda está só no estado não tem
-- região definida. Devolve o caminho da âncora e o do estado.
create or replace function app.region_anchor(p_profile uuid)
returns table (anchor_path extensions.ltree, state_path extensions.ltree)
language sql
stable
security definer
set search_path = ''
as $$
  select u.path, s.path
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  join public.units as s
    on s.state_code is not null
   and s.path operator(extensions.@>) u.path
   and s.path operator(extensions.<>) u.path
  where m.profile_id = p_profile and m.left_at is null and m.axis = 'team';
$$;

comment on function app.region_anchor(uuid) is
  'Vínculo de equipe da pessoa abaixo do estado (região definida), com o caminho do estado.';

-- A casa `key` na região da pessoa: a filha do ancestral mais próximo da âncora (ela
-- inclusive), dentro do estado. Sem região definida, ou sem a casa, devolve nulo.
create or replace function app.house_unit_for(p_profile uuid, p_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id
  from app.region_anchor(p_profile) as a
  join public.units as p
    on p.path operator(extensions.@>) a.anchor_path
   and p.path operator(extensions.<@) a.state_path
  join public.units as h on h.parent_id = p.id
  join public.unit_types as t on t.id = h.type_id
  where p_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(p_key) <= 63
    and t.membership_axis = 'house'
    and h.status = 'active'
    and h.slug = replace(p_key, '-', '_')
  order by extensions.nlevel(p.path) desc
  limit 1;
$$;

comment on function app.house_unit_for(uuid, text) is
  'Unidade da casa `key` (id da config) na região da pessoa, ou nulo.';

revoke execute on function app.region_anchor(uuid), app.house_unit_for(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------------------
-- Aceite do termo antes do questionário. A versão precisa existir; grava uma vez por versão
-- (repetir devolve a data do primeiro aceite e não gera outro registro de auditoria). Só
-- quem está liberado e ativo.
create or replace function public.record_questionnaire_consent(p_term_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  inserted integer;
  at timestamptz;
begin
  if caller is null or not app.is_active_member() then
    raise exception 'só quem está ativo responde ao questionário'
      using errcode = 'insufficient_privilege';
  end if;
  if p_term_version is null
     or not exists (select 1 from app.questionnaire_term_versions as v where v.version = p_term_version) then
    raise exception 'versão do termo desconhecida' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.questionnaire_consents (profile_id, term_version)
  values (caller, p_term_version)
  on conflict (profile_id, term_version) do nothing;
  get diagnostics inserted = row_count;

  if inserted > 0 then
    insert into public.audit_log (actor_id, event, term_version)
    values (caller, 'questionnaire_consented', p_term_version);
  end if;

  select c.consented_at into at
  from public.questionnaire_consents as c
  where c.profile_id = caller and c.term_version = p_term_version;
  return at;
end;
$$;

comment on function public.record_questionnaire_consent(text) is
  'Grava o aceite do termo do questionário (versão existente e data) de quem chama. Nunca respostas.';

-- Escolha e aceite da casa, de uma vez: a apresentação da casa é mostrada antes, no
-- aparelho, e só o "aceitar" chega aqui. Regras:
-- - só quem chama (não há parâmetro de pessoa), liberado e ativo, conferido depois de travar
--   o perfil;
-- - `questionnaire` exige o aceite de **exatamente** `term_version`, que precisa existir; a
--   versão fica gravada no vínculo. Em `self`, a versão é ignorada (fica nula);
-- - a região precisa estar definida (C7601) e a casa existir nela (P0002);
-- - com uma casa já aceita: a mesma casa devolve o mesmo vínculo (clique repetido); outra
--   casa é recusada (23505);
-- - vínculo de casa encerrado pela coordenação (ou pela operação) impede voltar sozinho, na
--   mesma casa ou em outra (C7602);
-- - um vínculo de casa aberto e ainda sem aceite é encerrado (pela própria pessoa) e dá
--   lugar ao novo.
-- Registra `house_accepted` no audit_log. Devolve o id da unidade da casa.
create or replace function public.accept_house(p_house_key text, p_join_method text, p_term_version text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  house uuid;
  consent_ver text;
  open_unit uuid;
  open_accepted timestamptz;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  -- Trava o perfil antes de conferir o status: uma suspensão simultânea não passa, e dois
  -- cliques não criam dois vínculos (o índice também barra).
  perform 1 from public.profiles as p where p.id = caller for update;
  if not app.is_active_member() then
    raise exception 'só quem está ativo escolhe a casa' using errcode = 'insufficient_privilege';
  end if;

  if p_join_method is null or p_join_method not in ('self', 'questionnaire') then
    raise exception 'forma de entrada inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_join_method = 'questionnaire' then
    if not exists (
      select 1 from public.questionnaire_consents as c
      where c.profile_id = caller and c.term_version = p_term_version
    ) then
      raise exception 'o questionário exige o termo desta versão aceito'
        using errcode = 'invalid_parameter_value';
    end if;
    consent_ver := p_term_version;
  end if;

  if not exists (select 1 from app.region_anchor(caller)) then
    raise exception 'sua região ainda não foi definida' using errcode = 'C7601';
  end if;

  house := app.house_unit_for(caller, p_house_key);
  if house is null then
    raise exception 'casa indisponível na região' using errcode = 'no_data_found';
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

  if exists (
    select 1 from public.unit_members as m
    where m.profile_id = caller
      and m.axis = 'house'
      and m.left_at is not null
      and m.ended_by is distinct from caller
  ) then
    raise exception 'a coordenação encerrou a sua casa; a volta é com ela' using errcode = 'C7602';
  end if;

  if open_unit is not null then
    update public.unit_members
    set left_at = now()
    where profile_id = caller and left_at is null and axis = 'house';
  end if;

  insert into public.unit_members (unit_id, profile_id, join_method, accepted_at, consent_version)
  values (house, caller, p_join_method, now(), consent_ver);

  insert into public.audit_log (actor_id, event, target_id, reason, term_version)
  values (caller, 'house_accepted', house, p_join_method, consent_ver);
  return house;
end;
$$;

comment on function public.accept_house(text, text, text) is
  'Quem chama aceita a casa `house_key` (id da config) na sua região; guarda a casa, a forma e a versão do termo.';

revoke execute on function
  public.record_questionnaire_consent(text),
  public.accept_house(text, text, text)
from public, anon;

grant execute on function
  public.record_questionnaire_consent(text),
  public.accept_house(text, text, text)
to authenticated;
