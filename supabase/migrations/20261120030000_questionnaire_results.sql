-- Chave nova do questionário das casas: totem, casa sugerida e fila de análise (issue #172,
-- ADR 0014; refs #91 #76).
--
-- O questionário passa a dar, além da casa, um totem (dois eixos extras). Quando um eixo empata
-- sem desempate, o resultado é inconclusivo: nenhuma casa é atribuída e as respostas vão à
-- coordenação nacional, num pedido de análise.
--
-- 1. `questionnaire_results`: a casa sugerida e o totem da pessoa (uma linha por pessoa, a mais
--    recente). Lê a própria pessoa e a coordenação nacional (`app.manages_root()`); o totem
--    NÃO está em `house_members`, que a coordenação territorial e a da casa leem.
-- 2. `house_analysis_requests`: a fila do caso inconclusivo. As respostas (`answers`) existem só
--    enquanto o pedido está aberto: ao resolver, ou quando a pessoa aceita uma casa ou refaz
--    o questionário com resultado conclusivo, viram nulas. A linha resolvida fica, sem respostas.
-- 3. Funções. A pontuação roda no SERVIDOR do app (ADR 0014 §1), que assina o resultado com uma
--    chave que só ele e o banco têm (`app.server_secrets`); o banco confere a assinatura, o
--    prazo de 5 minutos e que o resultado é da pessoa da sessão. O navegador, mesmo chamando a
--    API direto, não consegue impor casa nem totem nem abrir pedido:
--    - `record_questionnaire_result(termo, casa, totem, emitido_em, assinatura)`: grava o
--      resultado conclusivo e fecha um pedido aberto;
--    - `request_house_analysis(termo, eixos, respostas, emitido_em, assinatura)`: abre (ou
--      renova, no máximo uma vez por hora) o pedido e apaga o resultado anterior;
--    - `resolve_house_analysis(pedido, casa, totem)`: só a coordenação nacional, nunca sobre si
--      mesma e só sobre pessoa ativa; grava o resultado, apaga as respostas e audita.
--    Os pedidos abertos expiram em 30 dias (`app.analysis_max_age()`): as respostas deixam de
--    ser lidas na hora e são apagadas na próxima chamada de qualquer função acima.
--    Bloquear ou suspender a pessoa também fecha o pedido e apaga as respostas.
-- 4. Um gatilho em `house_members` fecha o pedido aberto quando a pessoa aceita uma casa
--    (escolha própria): as respostas não ficam sem motivo.
-- 5. `audit_log`: `house_analysis_requested` e `house_analysis_resolved` (sem respostas).
-- 6. `export_own_data()` inclui o resultado (com o totem) e os pedidos (LGPD art. 18).
--
-- Códigos de erro: 42501 sem permissão; P0002 casa indisponível ou pedido inexistente/fechado;
-- 22023 entrada inválida; 54000 pedido com respostas grandes demais.

-- ---------------------------------------------------------------------------------------
-- 0. Chave de assinatura (só servidor + banco) e prazo dos pedidos
-- ---------------------------------------------------------------------------------------
create table app.server_secrets (
  name text primary key,
  value text not null
);

comment on table app.server_secrets is
  'Segredos que o app e o banco compartilham (hoje: questionnaire_signing_key, ADR 0014). Sem grant nem política: só funções security definer leem. Instalada por quem opera (docs/OPERACAO.md).';

alter table app.server_secrets enable row level security;
revoke all on app.server_secrets from public, anon, authenticated;

-- Confere a assinatura HMAC-SHA256 (hex) que o servidor do app põe no resultado. Falha fechado:
-- sem chave instalada, sem assinatura, assinatura errada ou emitida há mais de 5 minutos.
create or replace function app.verify_server_signature(payload text, issued_at bigint, signature text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signing_key text;
  age_seconds bigint := extract(epoch from now())::bigint - issued_at;
begin
  select s.value into signing_key from app.server_secrets as s where s.name = 'questionnaire_signing_key';
  -- Chave ausente ou curta demais (menos de 32 caracteres) falha fechado. A comparação é entre
  -- digests, para não depender de onde as assinaturas começam a diferir.
  if signing_key is null or length(signing_key) < 32 or signature is null or issued_at is null
     or age_seconds not between -30 and 300
     or extensions.digest(convert_to(signature, 'utf8'), 'sha256')
        <> extensions.digest(convert_to(
             encode(extensions.hmac(convert_to(payload, 'utf8'), convert_to(signing_key, 'utf8'), 'sha256'), 'hex'),
             'utf8'), 'sha256') then
    raise exception 'resultado sem assinatura válida do servidor' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function app.verify_server_signature(text, bigint, text) from public, anon, authenticated;

-- Prazo máximo de um pedido aberto: depois dele as respostas não são mais lidas nem guardadas.
create or replace function app.analysis_max_age()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 days' $$;

revoke execute on function app.analysis_max_age() from public, anon;
grant execute on function app.analysis_max_age() to authenticated;

-- ---------------------------------------------------------------------------------------
-- 1. Leitura: a pessoa e a coordenação nacional
-- ---------------------------------------------------------------------------------------
create or replace function app.can_read_questionnaire_data(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and target is not null
    and (
      target = (select auth.uid())
      or (app.manages_root() and app.is_active_profile(target))
    );
$$;

comment on function app.can_read_questionnaire_data(uuid) is
  'Totem, casa sugerida e pedidos de análise: a própria pessoa, ou a coordenação nacional (gestor da raiz) sobre pessoa ativa (ADR 0014).';

revoke execute on function app.can_read_questionnaire_data(uuid) from public, anon;
grant execute on function app.can_read_questionnaire_data(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. questionnaire_results
-- ---------------------------------------------------------------------------------------
create table public.questionnaire_results (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  term_version text not null references app.questionnaire_term_versions (version),
  house_key text not null references public.houses (key) on delete restrict,
  totem text not null
    constraint questionnaire_results_totem_format check (totem ~ '^[A-Z]{2}$'),
  source text not null
    constraint questionnaire_results_source_check check (source in ('questionnaire', 'analysis')),
  created_at timestamptz not null default now()
);

comment on table public.questionnaire_results is
  'Casa sugerida e totem do questionário (ADR 0014). O totem é interno: só a pessoa e a coordenação nacional leem. Nunca as respostas.';
comment on column public.questionnaire_results.source is
  'questionnaire (pontuação no servidor do app) ou analysis (decidido pela coordenação nacional num pedido de análise).';

create index questionnaire_results_house_key_idx on public.questionnaire_results (house_key);
create index questionnaire_results_term_version_idx on public.questionnaire_results (term_version);

alter table public.questionnaire_results enable row level security;
revoke all on public.questionnaire_results from anon, authenticated;
grant select on public.questionnaire_results to authenticated;

create policy questionnaire_results_select on public.questionnaire_results
  for select to authenticated
  using (app.can_read_questionnaire_data(profile_id));

-- ---------------------------------------------------------------------------------------
-- 3. house_analysis_requests
-- ---------------------------------------------------------------------------------------
create table public.house_analysis_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  term_version text not null references app.questionnaire_term_versions (version),
  tied_axes text[] not null
    constraint house_analysis_requests_axes_check
      check (cardinality(tied_axes) between 1 and 4
             and tied_axes <@ array['house1', 'house2', 'totem1', 'totem2']),
  answers jsonb
    constraint house_analysis_requests_answers_shape
      check (answers is null or (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 4096)),
  status text not null default 'open'
    constraint house_analysis_requests_status_check check (status in ('open', 'resolved')),
  resolution text
    constraint house_analysis_requests_resolution_check check (resolution in ('coordination', 'self', 'inactive', 'expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  -- As respostas existem só enquanto o pedido está aberto.
  constraint house_analysis_requests_answers_only_open check ((status = 'open') = (answers is not null)),
  constraint house_analysis_requests_resolved_fields
    check ((status = 'resolved') = (resolved_at is not null and resolution is not null)),
  constraint house_analysis_requests_resolved_by_coordination
    check (resolved_by is null or resolution = 'coordination')
);

comment on table public.house_analysis_requests is
  'Fila do resultado inconclusivo (ADR 0014): a coordenação nacional decide a casa. As respostas só existem com o pedido aberto.';
comment on column public.house_analysis_requests.answers is
  'Respostas do questionário (item → a, b ou both), só com o pedido aberto; nulas depois de resolvido.';
comment on column public.house_analysis_requests.resolution is
  'coordination (a coordenação nacional decidiu), self (a pessoa aceitou uma casa ou refez o questionário), inactive (a pessoa foi bloqueada ou suspensa) ou expired (passou o prazo).';

create unique index house_analysis_requests_one_open
  on public.house_analysis_requests (profile_id) where status = 'open';
create index house_analysis_requests_profile_id_idx on public.house_analysis_requests (profile_id);
create index house_analysis_requests_resolved_by_idx on public.house_analysis_requests (resolved_by);
create index house_analysis_requests_term_version_idx on public.house_analysis_requests (term_version);

alter table public.house_analysis_requests enable row level security;
revoke all on public.house_analysis_requests from anon, authenticated;
grant select on public.house_analysis_requests to authenticated;

create policy house_analysis_requests_select on public.house_analysis_requests
  for select to authenticated
  using (
    app.can_read_questionnaire_data(profile_id)
    and (status = 'resolved' or created_at > now() - app.analysis_max_age())
  );

-- ---------------------------------------------------------------------------------------
-- 4. audit_log
-- ---------------------------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked',
  'house_analysis_requested', 'house_analysis_resolved'
));

-- Os eventos da fila só a coordenação nacional lê (o gestor territorial não, nem pelo alvo); a
-- pessoa os lê pelo export.
create or replace function app.can_read_audit(event text, target uuid, actor uuid default null, house text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and (
      (event = 'allowlist_imported' and app.manages_root())
      or (event in ('house_analysis_requested', 'house_analysis_resolved') and app.manages_root())
      or (
        target is not null
        and event not in ('house_analysis_requested', 'house_analysis_resolved')
        and app.manages_member(target)
      )
      or (
        event in ('house_accepted', 'questionnaire_consented')
        and actor is not null
        and actor = (select auth.uid())
      )
      or (
        event = 'house_accepted'
        and target is not null
        and house is not null
        and house = app.open_house_of(target)
        and app.is_house_coordinator_of((select auth.uid()), target)
      )
    );
$$;

-- ---------------------------------------------------------------------------------------
-- 5. Funções
-- ---------------------------------------------------------------------------------------
-- Trava o perfil de quem chama e confere que está ativo (como accept_house): uma suspensão
-- simultânea não passa e dois cliques não criam dois pedidos.
create or replace function app.lock_active_caller()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.profiles as p where p.id = caller for update;
  if not app.is_active_member() then
    raise exception 'só quem está ativo usa o questionário' using errcode = 'insufficient_privilege';
  end if;
  return caller;
end;
$$;

revoke execute on function app.lock_active_caller() from public, anon, authenticated;

-- Fecha o pedido aberto de `person` sem as respostas.
create or replace function app.close_open_analysis(person uuid, how text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.house_analysis_requests
  set status = 'resolved', answers = null, resolved_at = now(), resolution = how
  where profile_id = person and status = 'open';
$$;

revoke execute on function app.close_open_analysis(uuid, text) from public, anon, authenticated;

-- Apaga as respostas dos pedidos que passaram do prazo. Roda no começo das funções abaixo.
create or replace function app.purge_expired_analysis()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.house_analysis_requests
  set status = 'resolved', answers = null, resolved_at = now(), resolution = 'expired'
  where status = 'open' and created_at <= now() - app.analysis_max_age();
$$;

revoke execute on function app.purge_expired_analysis() from public, anon, authenticated;

-- Resultado conclusivo, calculado e assinado pelo servidor do app para a pessoa da sessão.
create or replace function public.record_questionnaire_result(
  p_term_version text, p_house_key text, p_totem text, p_issued_at bigint, p_signature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.lock_active_caller();
begin
  perform app.verify_server_signature(
    format('result|%s|%s|%s|%s|%s', caller, p_term_version, p_house_key, p_totem, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_totem is null or p_totem !~ '^[A-Z]{2}$' then
    raise exception 'totem inválido' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from public.questionnaire_consents as c
    where c.profile_id = caller and c.term_version = p_term_version
  ) then
    raise exception 'o questionário exige o termo desta versão aceito' using errcode = 'invalid_parameter_value';
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem, source)
  values (caller, p_term_version, p_house_key, p_totem, 'questionnaire')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem = excluded.totem, source = excluded.source, created_at = now();

  perform app.close_open_analysis(caller, 'self');
end;
$$;

comment on function public.record_questionnaire_result(text, text, text, bigint, text) is
  'Grava a casa sugerida e o totem da pessoa da sessão, só com a assinatura do servidor do app (ADR 0014).';

-- Resultado inconclusivo: o servidor do app pontua, assina e abre o pedido com as respostas
-- completas. Renovar o pedido aberto só depois de 1 hora (54000 antes disso).
create or replace function public.request_house_analysis(
  p_term_version text, p_tied_axes text[], p_answers jsonb, p_issued_at bigint, p_signature text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := app.lock_active_caller();
  request_id uuid;
  open_since timestamptz;
  answers_digest text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'respostas inválidas' using errcode = 'invalid_parameter_value';
  end if;
  -- A assinatura cobre o resumo (SHA-256) das respostas canonicalizadas: `id=valor`, ordenado pelo
  -- id e separado por vírgula. O app calcula o mesmo resumo; trocar uma resposta invalida a assinatura.
  select encode(extensions.digest(convert_to(coalesce(string_agg(e.key || '=' || (e.value #>> '{}'), ',' order by e.key collate "C"), ''), 'utf8'), 'sha256'), 'hex')
  into answers_digest
  from jsonb_each(p_answers) as e;
  perform app.verify_server_signature(
    format('analysis|%s|%s|%s|%s|%s', caller, p_term_version, array_to_string(p_tied_axes, ','), p_issued_at, answers_digest),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_tied_axes is null or cardinality(p_tied_axes) not between 1 and 4
     or not (p_tied_axes <@ array['house1', 'house2', 'totem1', 'totem2']) then
    raise exception 'eixos inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if octet_length(p_answers::text) > 4096 then
    raise exception 'respostas grandes demais' using errcode = 'program_limit_exceeded';
  end if;
  if exists (
    select 1 from jsonb_each(p_answers) as e
    where e.key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or e.value not in ('"a"'::jsonb, '"b"'::jsonb, '"both"'::jsonb)
  ) then
    raise exception 'respostas inválidas' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from public.questionnaire_consents as c
    where c.profile_id = caller and c.term_version = p_term_version
  ) then
    raise exception 'o questionário exige o termo desta versão aceito' using errcode = 'invalid_parameter_value';
  end if;

  select q.created_at into open_since
  from public.house_analysis_requests as q where q.profile_id = caller and q.status = 'open';
  if open_since is not null and open_since > now() - interval '1 hour' then
    raise exception 'pedido renovado há pouco; tente mais tarde' using errcode = 'program_limit_exceeded';
  end if;

  update public.house_analysis_requests
  set term_version = p_term_version, tied_axes = p_tied_axes, answers = p_answers, created_at = now()
  where profile_id = caller and status = 'open'
  returning id into request_id;

  if request_id is null then
    insert into public.house_analysis_requests (profile_id, term_version, tied_axes, answers)
    values (caller, p_term_version, p_tied_axes, p_answers)
    returning id into request_id;
    insert into public.audit_log (actor_id, event, target_id)
    values (caller, 'house_analysis_requested', caller);
  end if;

  -- Um resultado anterior deixa de valer: o último questionário foi inconclusivo.
  delete from public.questionnaire_results where profile_id = caller;
  return request_id;
end;
$$;

comment on function public.request_house_analysis(text, text[], jsonb, bigint, text) is
  'Abre o pedido de análise da pessoa da sessão, só com a assinatura do servidor do app; as respostas são apagadas ao resolver (ADR 0014).';

-- A coordenação nacional decide a casa e o totem; as respostas são apagadas.
create or replace function public.resolve_house_analysis(p_request_id uuid, p_house_key text, p_totem text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  person uuid;
  version text;
begin
  if caller is null or not app.manages_root() then
    raise exception 'só a coordenação nacional resolve pedidos de análise' using errcode = 'insufficient_privilege';
  end if;
  perform app.purge_expired_analysis();
  if p_totem is null or p_totem !~ '^[A-Z]{2}$' then
    raise exception 'totem inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_house_key is null or not app.is_open_house(p_house_key) then
    raise exception 'casa indisponível' using errcode = 'no_data_found';
  end if;

  select q.profile_id into person
  from public.house_analysis_requests as q
  where q.id = p_request_id and q.status = 'open';
  if person is null then
    raise exception 'pedido inexistente ou já resolvido' using errcode = 'no_data_found';
  end if;
  if person = caller then
    raise exception 'a coordenação não resolve o próprio pedido' using errcode = 'insufficient_privilege';
  end if;
  -- Trava o perfil antes do pedido, na mesma ordem de app.lock_active_caller (a pessoa refazendo o
  -- questionário não corre com a resolução), e só resolve para quem está ativo.
  perform 1 from public.profiles as p where p.id = person for update;
  if not app.is_active_profile(person) then
    raise exception 'só pedidos de quem está ativo' using errcode = 'insufficient_privilege';
  end if;
  select q.term_version into version
  from public.house_analysis_requests as q
  where q.id = p_request_id and q.status = 'open'
  for update;
  if version is null then
    raise exception 'pedido inexistente ou já resolvido' using errcode = 'no_data_found';
  end if;

  update public.house_analysis_requests
  set status = 'resolved', answers = null, resolved_at = now(), resolution = 'coordination', resolved_by = caller
  where id = p_request_id;

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem, source)
  values (person, version, p_house_key, p_totem, 'analysis')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem = excluded.totem, source = excluded.source, created_at = now();

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'house_analysis_resolved', person);
end;
$$;

comment on function public.resolve_house_analysis(uuid, text, text) is
  'A coordenação nacional resolve o pedido: grava a casa e o totem, apaga as respostas e audita (ADR 0014).';

revoke execute on function public.record_questionnaire_result(text, text, text, bigint, text) from public, anon;
revoke execute on function public.request_house_analysis(text, text[], jsonb, bigint, text) from public, anon;
revoke execute on function public.resolve_house_analysis(uuid, text, text) from public, anon;
grant execute on function public.record_questionnaire_result(text, text, text, bigint, text) to authenticated;
grant execute on function public.request_house_analysis(text, text[], jsonb, bigint, text) to authenticated;
grant execute on function public.resolve_house_analysis(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. Aceitar uma casa fecha o pedido aberto
-- ---------------------------------------------------------------------------------------
create or replace function app.tg_house_members_close_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.accepted_at is not null then
    perform app.close_open_analysis(new.profile_id, 'self');
  end if;
  return null;
end;
$$;

revoke execute on function app.tg_house_members_close_analysis() from public, anon, authenticated;

create trigger house_members_close_analysis
  after insert on public.house_members
  for each row execute function app.tg_house_members_close_analysis();

-- Bloquear ou suspender a pessoa fecha o pedido aberto e apaga as respostas.
create or replace function app.tg_profiles_close_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.access_status <> 'active' or new.status <> 'active' then
    perform app.close_open_analysis(new.id, 'inactive');
  end if;
  return null;
end;
$$;

revoke execute on function app.tg_profiles_close_analysis() from public, anon, authenticated;

create trigger profiles_close_analysis
  after update of access_status, status on public.profiles
  for each row execute function app.tg_profiles_close_analysis();

-- ---------------------------------------------------------------------------------------
-- 7. export_own_data (redefinida inteira; a anterior é a de 20261120010000_accept_consent.sql)
-- ---------------------------------------------------------------------------------------
create or replace function public.export_own_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_per_hour constant integer := 5;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('export_own_data:' || caller::text, 0));
  if (
    select count(*) from public.audit_log as a
    where a.actor_id = caller
      and a.event = 'data_exported'
      and a.created_at > now() - interval '1 hour'
  ) >= max_per_hour then
    raise exception 'limite de exportações por hora atingido'
      using errcode = 'program_limit_exceeded';
  end if;

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'data_exported', caller);

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'display_name_enc', p.display_name_enc,
        'municipality_code', p.municipality_code,
        'municipality_name', m.name,
        'state_code', p.state_code,
        'district', p.district,
        'status', p.status,
        'access_status', p.access_status,
        'consent_version', p.consent_version,
        'consent_at', p.consent_at,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      from public.profiles as p
      left join public.municipalities as m on m.code = p.municipality_code
      where p.id = caller
    ),
    'contact', (
      select jsonb_build_object(
        'whatsapp_enc', c.whatsapp_enc,
        'social_links_enc', c.social_links_enc,
        'updated_at', c.updated_at
      )
      from public.profile_contacts as c
      where c.profile_id = caller
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_name', u.name,
        'unit_type', t.label,
        'member_role', um.member_role,
        'joined_at', um.joined_at,
        'left_at', um.left_at
      ) order by um.joined_at, um.id)
      from public.unit_members as um
      join public.units as u on u.id = um.unit_id
      join public.unit_types as t on t.id = u.type_id
      where um.profile_id = caller
    ), '[]'::jsonb),
    'house_memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'house_key', h.house_key,
        'join_method', h.join_method,
        'consent_version', h.consent_version,
        'joined_at', h.joined_at,
        'accepted_at', h.accepted_at,
        'left_at', h.left_at
      ) order by h.joined_at, h.id)
      from public.house_members as h
      where h.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'term_version', q.term_version,
        'consented_at', q.consented_at
      ) order by q.consented_at, q.term_version)
      from public.questionnaire_consents as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'consent_acceptances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version', c.version,
        'accepted_at', c.accepted_at
      ) order by c.accepted_at, c.version)
      from public.consent_acceptances as c
      where c.user_id = caller
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', r.role,
        'unit_name', u.name,
        'unit_type', t.label,
        'house_key', r.house_key,
        'granted_at', r.granted_at,
        'revoked_at', r.revoked_at
      ) order by r.granted_at, r.id)
      from public.role_assignments as r
      join public.units as u on u.id = r.unit_id
      join public.unit_types as t on t.id = u.type_id
      where r.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_result', (
      select jsonb_build_object(
        'house_key', r.house_key,
        'totem', r.totem,
        'term_version', r.term_version,
        'source', r.source,
        'created_at', r.created_at
      )
      from public.questionnaire_results as r
      where r.profile_id = caller
    ),
    'house_analysis_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', q.status,
        'resolution', q.resolution,
        'term_version', q.term_version,
        'tied_axes', q.tied_axes,
        'answers', q.answers,
        'created_at', q.created_at,
        'resolved_at', q.resolved_at
      ) order by q.created_at, q.id)
      from public.house_analysis_requests as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', a.event,
        'reason', a.reason,
        'term_version', a.term_version,
        'house_key', a.house_key,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.audit_log as a
      where a.target_id = caller
         or (a.actor_id = caller and a.event in ('house_accepted', 'questionnaire_consented', 'consent_accepted'))
    ), '[]'::jsonb),
    'contact_views', coalesce((
      select jsonb_agg(jsonb_build_object(
        'viewer_id', a.actor_id,
        'viewer_name_enc', p.display_name_enc,
        'kind', a.reason,
        'viewed_at', a.created_at
      ) order by a.created_at, a.id)
      from public.audit_log as a
      left join public.profiles as p on p.id = a.actor_id
      where a.target_id = caller
        and a.event = 'contact_viewed'
    ), '[]'::jsonb)
  );
end;
$$;
