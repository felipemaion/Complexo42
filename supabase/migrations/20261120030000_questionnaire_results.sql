-- Chave nova do questionário das casas: totem, casa sugerida e fila de análise (issue #172,
-- ADR 0014; refs #91 #76).
--
-- O questionário passa a dar, além da casa, um totem (dois eixos extras). Quando um eixo empata
-- sem desempate, o resultado é inconclusivo: nenhuma casa é atribuída e as respostas vão à
-- coordenação nacional, num pedido de análise.
--
-- 1. `questionnaire_results`: a casa sugerida e o totem da pessoa (uma linha por pessoa, a mais
--    recente). O totem é dado pessoal e fica CIFRADO (`totem_enc`, AES-256-GCM, ADR 0003; AAD
--    `questionnaire_results.totem_enc.<profile_id>`): quem cifra e decifra é o servidor do app,
--    o banco só guarda o valor. Lê a própria pessoa, a coordenação nacional (`app.manages_root()`)
--    e quem a nacional delegou (seção 1b); o totem NÃO está em `house_members`, que a
--    coordenação territorial e a da casa leem.
-- 2. `house_analysis_requests`: a fila do caso inconclusivo. As respostas (`answers_enc`, cifradas
--    como o totem; AAD `house_analysis_requests.answers_enc.<profile_id>`) existem só enquanto
--    o pedido está aberto: ao resolver, ou quando a pessoa aceita uma casa ou refaz o
--    questionário com resultado conclusivo, viram nulas. A linha resolvida fica, sem respostas.
-- 3. Funções. A pontuação roda no SERVIDOR do app (ADR 0014 §1), que assina o resultado com uma
--    chave que só ele e o banco têm (`app.server_secrets`); o banco confere a assinatura, o
--    prazo de 5 minutos e que o resultado é da pessoa da sessão. O navegador, mesmo chamando a
--    API direto, não consegue impor casa nem totem nem abrir pedido:
--    - `record_questionnaire_result(termo, casa, totem_enc, emitido_em, assinatura)`: grava o
--      resultado conclusivo e fecha um pedido aberto;
--    - `request_house_analysis(termo, eixos, respostas_enc, emitido_em, assinatura)`: abre (ou
--      renova, no máximo uma vez por hora) o pedido e apaga o resultado anterior;
--    - `resolve_house_analysis(pedido, casa, totem_enc, emitido_em, assinatura)`: só a coordenação
--      nacional (e com a assinatura do servidor), nunca sobre si mesma e só sobre pessoa ativa;
--      grava o resultado, apaga as respostas e audita.
--    A assinatura cobre o valor cifrado: o navegador não troca nem o totem nem as respostas.
--    Como o banco não decifra, ele não valida o conteúdo das respostas: a garantia é a assinatura.
--    Os pedidos abertos expiram em 30 dias (`app.analysis_max_age()`): as respostas deixam de
--    ser lidas na hora e são apagadas na próxima chamada de qualquer função acima.
--    Bloquear ou suspender a pessoa também fecha o pedido e apaga as respostas.
-- 3b. Delegação (decisão do gestor): `questionnaire_data_grants`. A coordenação nacional concede,
--    de forma explícita, revogável e auditada, a um gestor de unidade abaixo da raiz o direito de
--    ler totem, pedidos de análise e os eventos `house_analysis_*` das pessoas ATIVAS no escopo
--    dele (`units.path <@`). Sem concessão, só a nacional lê. Resolver a fila segue só da
--    nacional. A concessão só vale enquanto o gestor mantém o papel de gestor na unidade.
-- 4. Um gatilho em `house_members` fecha o pedido aberto quando a pessoa aceita uma casa
--    (escolha própria): as respostas não ficam sem motivo.
-- 5. `audit_log`: `house_analysis_requested` e `house_analysis_resolved` (sem respostas),
--    `questionnaire_access_granted` e `questionnaire_access_revoked` (a delegação).
-- 6. `export_own_data()` inclui o resultado (totem cifrado; o servidor decifra) e os pedidos
--    (LGPD art. 18), e as concessões recebidas.
--
-- Códigos de erro: 42501 sem permissão; P0002 casa indisponível ou pedido inexistente/fechado;
-- 22023 entrada inválida; 54000 renovação cedo demais.

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
-- 1. Leitura: a pessoa, a coordenação nacional e quem ela delegou
-- ---------------------------------------------------------------------------------------
-- 1b. Delegação: concessão explícita, revogável e auditada. Só o gestor ativo da raiz concede
-- e revoga; ninguém concede a si mesmo; vale só para gestor de unidade ABAIXO da raiz, só
-- enquanto o MESMO papel de gestor segue ativo (revogado o papel, a concessão não volta com um papel
-- novo: precisa de nova decisão da nacional), e só sobre pessoas ativas com vínculo aberto na
-- unidade ou abaixo dela. Sem linha ativa aqui, só a coordenação nacional lê.
create table public.questionnaire_data_grants (
  id uuid primary key default gen_random_uuid(),
  grantee_id uuid not null references public.profiles (id) on delete cascade,
  unit_id uuid not null references public.units (id) on delete restrict,
  -- A concessão é amarrada ao papel de gestor que existia ao conceder: se esse papel for revogado
  -- e depois concedido de novo (outra linha), a concessão antiga NÃO volta a valer.
  role_assignment_id uuid not null references public.role_assignments (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  constraint questionnaire_data_grants_revoked_after_granted
    check (revoked_at is null or revoked_at >= granted_at)
);

comment on table public.questionnaire_data_grants is
  'Delegação do acesso ao totem e aos pedidos de análise (ADR 0014): a coordenação nacional concede a um gestor de unidade abaixo da raiz, para as pessoas ativas do escopo dele. Revogável; cada concessão e revogação é auditada.';

create unique index questionnaire_data_grants_one_active
  on public.questionnaire_data_grants (grantee_id, unit_id) where revoked_at is null;
create index questionnaire_data_grants_role_assignment_id_idx on public.questionnaire_data_grants (role_assignment_id);
create index questionnaire_data_grants_unit_id_idx on public.questionnaire_data_grants (unit_id);
create index questionnaire_data_grants_granted_by_idx on public.questionnaire_data_grants (granted_by);
create index questionnaire_data_grants_revoked_by_idx on public.questionnaire_data_grants (revoked_by);

alter table public.questionnaire_data_grants enable row level security;
revoke all on public.questionnaire_data_grants from anon, authenticated;
grant select on public.questionnaire_data_grants to authenticated;

-- Escrita só pelas funções abaixo. Lê a coordenação nacional e o próprio gestor que recebeu.
create policy questionnaire_data_grants_select on public.questionnaire_data_grants
  for select to authenticated
  using (app.is_active_member() and (grantee_id = (select auth.uid()) or app.manages_root()));

-- Quem chama tem concessão ativa que cobre `target`? A pessoa precisa estar ativa e ter vínculo
-- aberto numa unidade igual ou abaixo da unidade da concessão; o papel de gestor a que a
-- concessão foi amarrada (`role_assignment_id`) ainda precisa estar ativo; nunca sobre si mesmo.
create or replace function app.has_questionnaire_delegation_over(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_active_member()
    and target is not null
    and target <> (select auth.uid())
    and app.is_active_profile(target)
    and exists (
      select 1
      from public.questionnaire_data_grants as g
      join public.units as gu on gu.id = g.unit_id
      join public.role_assignments as r
        on r.id = g.role_assignment_id and r.profile_id = g.grantee_id and r.unit_id = g.unit_id
           and r.role = 'manager' and r.revoked_at is null
      join public.unit_members as m on m.profile_id = target and m.left_at is null
      join public.units as mu on mu.id = m.unit_id
      where g.grantee_id = (select auth.uid())
        and g.revoked_at is null
        and gu.parent_id is not null
        and mu.path operator(extensions.<@) gu.path
    );
$$;

comment on function app.has_questionnaire_delegation_over(uuid) is
  'Quem chama recebeu da coordenação nacional (e mantém) o direito de ver o totem e os pedidos de análise desta pessoa ativa, pelo escopo da unidade (ADR 0014).';

revoke execute on function app.has_questionnaire_delegation_over(uuid) from public, anon, authenticated;

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
      or app.has_questionnaire_delegation_over(target)
    );
$$;

comment on function app.can_read_questionnaire_data(uuid) is
  'Totem, casa sugerida e pedidos de análise: a própria pessoa, a coordenação nacional (gestor da raiz) sobre pessoa ativa, ou um gestor com delegação ativa sobre pessoa ativa do escopo dele (ADR 0014).';

revoke execute on function app.can_read_questionnaire_data(uuid) from public, anon;
grant execute on function app.can_read_questionnaire_data(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. questionnaire_results
-- ---------------------------------------------------------------------------------------
create table public.questionnaire_results (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  term_version text not null references app.questionnaire_term_versions (version),
  house_key text not null references public.houses (key) on delete restrict,
  totem_enc text not null
    constraint questionnaire_results_totem_enc_format check (app.is_encrypted_value(totem_enc, 256)),
  source text not null
    constraint questionnaire_results_source_check check (source in ('questionnaire', 'analysis')),
  created_at timestamptz not null default now()
);

comment on table public.questionnaire_results is
  'Casa sugerida e totem do questionário (ADR 0014). O totem é interno e fica cifrado (totem_enc): leem a pessoa, a coordenação nacional e quem ela delegou. Nunca as respostas.';
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
  answers_enc text
    constraint house_analysis_requests_answers_enc_format check (answers_enc is null or app.is_encrypted_value(answers_enc, 8192)),
  status text not null default 'open'
    constraint house_analysis_requests_status_check check (status in ('open', 'resolved')),
  resolution text
    constraint house_analysis_requests_resolution_check check (resolution in ('coordination', 'self', 'inactive', 'expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  -- As respostas existem só enquanto o pedido está aberto.
  constraint house_analysis_requests_answers_only_open check ((status = 'open') = (answers_enc is not null)),
  constraint house_analysis_requests_resolved_fields
    check ((status = 'resolved') = (resolved_at is not null and resolution is not null)),
  constraint house_analysis_requests_resolved_by_coordination
    check (resolved_by is null or resolution = 'coordination')
);

comment on table public.house_analysis_requests is
  'Fila do resultado inconclusivo (ADR 0014): a coordenação nacional decide a casa. As respostas só existem com o pedido aberto.';
comment on column public.house_analysis_requests.answers_enc is
  'Respostas do questionário (item → a, b ou both) como JSON cifrado pelo servidor (ADR 0003), só com o pedido aberto; nulas depois de resolvido.';
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
-- Concessão de acesso (seção 3b): o evento guarda a unidade e a concessão (ids, sem dado pessoal),
-- para a auditoria dizer inequivocamente o que foi concedido ou revogado. Uuids soltos (sem FK),
-- como os demais ids do log: a trilha sobrevive à unidade e à concessão.
alter table public.audit_log
  add column unit_id uuid,
  add column grant_id uuid,
  add constraint audit_log_access_grant_ids check (
    (event in ('questionnaire_access_granted', 'questionnaire_access_revoked')) = (unit_id is not null and grant_id is not null)
    and (unit_id is null) = (grant_id is null)
  );

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked',
  'house_analysis_requested', 'house_analysis_resolved',
  'questionnaire_access_granted', 'questionnaire_access_revoked'
));

-- Os eventos da fila (`house_analysis_*`) leem a coordenação nacional e quem ela delegou sobre
-- aquela pessoa (o gestor territorial comum não, nem pelo alvo); os da delegação
-- (`questionnaire_access_*`) só a coordenação nacional. A pessoa lê os seus pelo export.
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
        event in ('house_analysis_requested', 'house_analysis_resolved')
        and target is not null
        and app.has_questionnaire_delegation_over(target)
      )
      or (event in ('questionnaire_access_granted', 'questionnaire_access_revoked') and app.manages_root())
      or (
        target is not null
        and event not in ('house_analysis_requested', 'house_analysis_resolved',
                          'questionnaire_access_granted', 'questionnaire_access_revoked')
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
  set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = how
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
  set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = 'expired'
  where status = 'open' and created_at <= now() - app.analysis_max_age();
$$;

revoke execute on function app.purge_expired_analysis() from public, anon, authenticated;

-- Resultado conclusivo, calculado, cifrado e assinado pelo servidor do app para a pessoa da sessão.
-- `p_totem_enc` é o totem cifrado (AAD `questionnaire_results.totem_enc.<profile_id>`).
create or replace function public.record_questionnaire_result(
  p_term_version text, p_house_key text, p_totem_enc text, p_issued_at bigint, p_signature text
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
    format('result|%s|%s|%s|%s|%s', caller, p_term_version, p_house_key, p_totem_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_totem_enc is null or not app.is_encrypted_value(p_totem_enc, 256) then
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

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source)
  values (caller, p_term_version, p_house_key, p_totem_enc, 'questionnaire')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = excluded.totem_enc, source = excluded.source, created_at = now();

  perform app.close_open_analysis(caller, 'self');
end;
$$;

comment on function public.record_questionnaire_result(text, text, text, bigint, text) is
  'Grava a casa sugerida e o totem (cifrado) da pessoa da sessão, só com a assinatura do servidor do app (ADR 0014).';

-- Resultado inconclusivo: o servidor do app pontua, cifra as respostas, assina e abre o pedido.
-- `p_answers_enc` é o JSON das respostas cifrado (AAD `house_analysis_requests.answers_enc.<profile_id>`).
-- O banco não decifra: a garantia de que são respostas completas e válidas é a assinatura do
-- servidor. Renovar o pedido aberto só depois de 1 hora (54000 antes disso).
create or replace function public.request_house_analysis(
  p_term_version text, p_tied_axes text[], p_answers_enc text, p_issued_at bigint, p_signature text
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
begin
  perform app.verify_server_signature(
    format('analysis|%s|%s|%s|%s|%s', caller, p_term_version, array_to_string(p_tied_axes, ','), p_answers_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_tied_axes is null or cardinality(p_tied_axes) not between 1 and 4
     or not (p_tied_axes <@ array['house1', 'house2', 'totem1', 'totem2']) then
    raise exception 'eixos inválidos' using errcode = 'invalid_parameter_value';
  end if;
  if p_answers_enc is null or not app.is_encrypted_value(p_answers_enc, 8192) then
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
  set term_version = p_term_version, tied_axes = p_tied_axes, answers_enc = p_answers_enc, created_at = now()
  where profile_id = caller and status = 'open'
  returning id into request_id;

  if request_id is null then
    insert into public.house_analysis_requests (profile_id, term_version, tied_axes, answers_enc)
    values (caller, p_term_version, p_tied_axes, p_answers_enc)
    returning id into request_id;
    insert into public.audit_log (actor_id, event, target_id)
    values (caller, 'house_analysis_requested', caller);
  end if;

  -- Um resultado anterior deixa de valer: o último questionário foi inconclusivo.
  delete from public.questionnaire_results where profile_id = caller;
  return request_id;
end;
$$;

comment on function public.request_house_analysis(text, text[], text, bigint, text) is
  'Abre o pedido de análise da pessoa da sessão (respostas cifradas), só com a assinatura do servidor do app; as respostas são apagadas ao resolver (ADR 0014).';

-- A coordenação nacional decide a casa e o totem; as respostas são apagadas.
create or replace function public.resolve_house_analysis(
  p_request_id uuid, p_house_key text, p_totem_enc text, p_issued_at bigint, p_signature text
)
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
  -- O servidor do app cifra o totem e assina a resolução (pedido, casa, totem cifrado): sem isso,
  -- a coordenação, pela API direta, gravaria qualquer valor com o formato de cifrado.
  perform app.verify_server_signature(
    format('resolve|%s|%s|%s|%s|%s', caller, p_request_id, p_house_key, p_totem_enc, p_issued_at),
    p_issued_at, p_signature);
  perform app.purge_expired_analysis();
  if p_totem_enc is null or not app.is_encrypted_value(p_totem_enc, 256) then
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
  set status = 'resolved', answers_enc = null, resolved_at = now(), resolution = 'coordination', resolved_by = caller
  where id = p_request_id;

  insert into public.questionnaire_results (profile_id, term_version, house_key, totem_enc, source)
  values (person, version, p_house_key, p_totem_enc, 'analysis')
  on conflict (profile_id) do update
    set term_version = excluded.term_version, house_key = excluded.house_key,
        totem_enc = excluded.totem_enc, source = excluded.source, created_at = now();

  insert into public.audit_log (actor_id, event, target_id)
  values (caller, 'house_analysis_resolved', person);
end;
$$;

comment on function public.resolve_house_analysis(uuid, text, text, bigint, text) is
  'A coordenação nacional resolve o pedido, assinado pelo servidor do app: grava a casa e o totem (cifrado pelo servidor), apaga as respostas e audita (ADR 0014). A delegação NÃO inclui resolver.';

-- Delegação (seção 1b): só o gestor ativo da raiz concede e revoga; cada ato é auditado.
create or replace function public.grant_questionnaire_access(p_grantee uuid, p_unit_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  grant_id uuid;
  manager_role uuid;
  stale uuid;
begin
  if caller is null or not app.manages_root() then
    raise exception 'só a coordenação nacional delega o acesso' using errcode = 'insufficient_privilege';
  end if;
  if p_grantee is null or p_grantee = caller then
    raise exception 'ninguém concede o acesso a si mesmo' using errcode = 'insufficient_privilege';
  end if;
  if not app.is_active_profile(p_grantee) then
    raise exception 'só a quem está ativo' using errcode = 'invalid_parameter_value';
  end if;
  -- Unidade abaixo da raiz, onde o gestor tem o papel de gestor ativo.
  select r.id into manager_role
  from public.units as u
  join public.role_assignments as r on r.unit_id = u.id
  where u.id = p_unit_id and u.parent_id is not null
    and r.profile_id = p_grantee and r.role = 'manager' and r.revoked_at is null;
  if manager_role is null then
    raise exception 'a pessoa precisa ser gestora ativa de uma unidade abaixo da raiz' using errcode = 'invalid_parameter_value';
  end if;
  -- Concessão antiga amarrada a um papel que já foi revogado (e não vale mais) é encerrada aqui,
  -- com o evento de revogação, para que a nova decisão da nacional a substitua.
  for stale in
    update public.questionnaire_data_grants as g
    set revoked_at = now(), revoked_by = caller
    where g.grantee_id = p_grantee and g.unit_id = p_unit_id and g.revoked_at is null
      and not exists (
        select 1 from public.role_assignments as r where r.id = g.role_assignment_id and r.revoked_at is null
      )
    returning g.id
  loop
    insert into public.audit_log (actor_id, event, target_id, unit_id, grant_id)
    values (caller, 'questionnaire_access_revoked', p_grantee, p_unit_id, stale);
  end loop;
  if exists (
    select 1 from public.questionnaire_data_grants as g
    where g.grantee_id = p_grantee and g.unit_id = p_unit_id and g.revoked_at is null
  ) then
    raise exception 'a concessão já existe' using errcode = 'unique_violation';
  end if;

  insert into public.questionnaire_data_grants (grantee_id, unit_id, role_assignment_id, granted_by)
  values (p_grantee, p_unit_id, manager_role, caller)
  returning id into grant_id;
  insert into public.audit_log (actor_id, event, target_id, unit_id, grant_id)
  values (caller, 'questionnaire_access_granted', p_grantee, p_unit_id, grant_id);
  return grant_id;
end;
$$;

comment on function public.grant_questionnaire_access(uuid, uuid) is
  'A coordenação nacional concede a um gestor de unidade abaixo da raiz o acesso ao totem e aos pedidos de análise das pessoas ativas do escopo dele. Auditada (ADR 0014).';

create or replace function public.revoke_questionnaire_access(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  grantee uuid;
  grant_unit uuid;
begin
  if caller is null or not app.manages_root() then
    raise exception 'só a coordenação nacional revoga o acesso' using errcode = 'insufficient_privilege';
  end if;
  update public.questionnaire_data_grants
  set revoked_at = now(), revoked_by = caller
  where id = p_grant_id and revoked_at is null
  returning grantee_id, unit_id into grantee, grant_unit;
  if grantee is null then
    raise exception 'concessão inexistente ou já revogada' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (actor_id, event, target_id, unit_id, grant_id)
  values (caller, 'questionnaire_access_revoked', grantee, grant_unit, p_grant_id);
end;
$$;

comment on function public.revoke_questionnaire_access(uuid) is
  'A coordenação nacional revoga uma concessão de acesso ao totem e aos pedidos. Auditada (ADR 0014).';

revoke execute on function public.record_questionnaire_result(text, text, text, bigint, text) from public, anon;
revoke execute on function public.request_house_analysis(text, text[], text, bigint, text) from public, anon;
revoke execute on function public.resolve_house_analysis(uuid, text, text, bigint, text) from public, anon;
revoke execute on function public.grant_questionnaire_access(uuid, uuid) from public, anon;
revoke execute on function public.revoke_questionnaire_access(uuid) from public, anon;
grant execute on function public.record_questionnaire_result(text, text, text, bigint, text) to authenticated;
grant execute on function public.request_house_analysis(text, text[], text, bigint, text) to authenticated;
grant execute on function public.resolve_house_analysis(uuid, text, text, bigint, text) to authenticated;
grant execute on function public.grant_questionnaire_access(uuid, uuid) to authenticated;
grant execute on function public.revoke_questionnaire_access(uuid) to authenticated;

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
        'totem_enc', r.totem_enc,
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
        'answers_enc', q.answers_enc,
        'created_at', q.created_at,
        'resolved_at', q.resolved_at
      ) order by q.created_at, q.id)
      from public.house_analysis_requests as q
      where q.profile_id = caller
    ), '[]'::jsonb),
    'questionnaire_access_grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_name', u.name,
        'unit_type', t.label,
        'granted_at', g.granted_at,
        'revoked_at', g.revoked_at
      ) order by g.granted_at, g.id)
      from public.questionnaire_data_grants as g
      join public.units as u on u.id = g.unit_id
      join public.unit_types as t on t.id = u.type_id
      where g.grantee_id = caller
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
