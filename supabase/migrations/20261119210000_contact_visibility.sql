-- Quem vê o contato de cada pessoa (issue #119, ADR 0010).
--
-- 1. `contact_visibility`: a escolha da pessoa, contato por contato (`kind`: `whatsapp`,
--    `social`, `email`), entre `none` (padrão; sem linha também é `none`), `team` e
--    `team_house`. Só o dono lê (RLS) e só ele grava, pela função `set_contact_visibility`.
-- 2. `app.can_view_contact(target, kind)` substitui a versão sem o tipo. Permite:
--    - ao próprio titular;
--    - à coordenação do escopo, como antes: monitor ou manager com papel na unidade de um
--      vínculo aberto do alvo no eixo `team`, ou acima dela; e o coordenador da casa para os
--      membros da casa (vínculo de casa aceito), isolado em `app.is_house_coordinator_of`. Não
--      inclui o porta-voz nem o admin técnico (que não têm escopo de contato);
--    - a um colega, quando a escolha do alvo para aquele contato permite:
--      - `team`: os dois têm vínculo aberto na MESMA equipe;
--      - `team_house`: a mesma equipe, ou a mesma casa NA MESMA REGIÃO (abaixo).
--    Quem chama e o alvo precisam estar ativos (ADR 0008 §1): quem não está não vê nem é visto.
--    - "Mesma equipe" (`app.shares_open_team`): uma unidade ativa de um tipo marcado como equipe
--      (`unit_types.is_team`, novo; o seed marca o tipo `team`). Não se infere pela forma da
--      árvore: a unidade de entrada do estado e a região reúnem todo mundo que ainda não tem
--      equipe, e dividir uma delas não faz de ninguém colega (nota da #46).
--    - "Mesma casa" (`app.shares_open_house`, revisão do #138): a mesma casa, os dois vínculos
--      aceitos e abertos, os dois aceitos há pelo menos 7 dias, e o mesmo território mais
--      próximo (`app.home_territory`: a região do vínculo de equipe, ou o estado se não houver
--      região). Com a casa nacional do ADR 0011, "minha casa" sem isso seria o país inteiro; e
--      sem a carência, entrar numa casa daria acesso no mesmo dia.
--    - O modelo de casa vai mudar (ADR 0011): a troca mexe só no corpo de `shares_open_house` e
--      de `is_house_coordinator_of`.
-- 3. A leitura do contato de terceiros sai SÓ por `public.view_contact(target, kind)`,
--    `security definer`: aplica `app.can_view_contact`, grava `contact_viewed` (quem viu, de
--    quem, o tipo em `reason`, quando; nunca o valor) só quando há valor, uma vez por ator, alvo
--    e tipo a cada 10 minutos, e limita a 60 pessoas distintas por hora (erro 54000, mesmo
--    padrão de `export_own_data`). Devolve o valor como está guardado
--    (WhatsApp e redes cifrados: quem decifra é o servidor, R13). O e-mail de login é lido de
--    `auth.users` só aqui. A política de SELECT de `profile_contacts` passa a ser só do
--    titular: a leitura direta pela coordenação não era auditada.
-- 4. `public.list_contact_views()`: quem acessou o contato de quem chama (o nome cifrado de
--    quem viu, para o servidor decifrar; o tipo e quando). O id de quem viu vai junto porque é o
--    AAD da decifragem (ADR 0003); a tela e o arquivo mostram só o nome. Limite conhecido
--    (ADR 0010): quem chama a RPC direto vê o id; a pessoa já tem o direito de saber quem viu. `export_own_data` (#20) passa a
--    trazer a mesma lista em `contact_views`.
-- 5. `audit_log.reason` em `contact_viewed` é o tipo do contato (obrigatório). A constraint
--    `audit_log_reason_by_event` é redefinida inteira (a última migration vence): quem mexer
--    nela depois parte desta versão. A lista de eventos não muda (`contact_viewed` já existe).

-- ---------------------------------------------------------------------------------------
-- 1. contact_visibility
-- ---------------------------------------------------------------------------------------
-- Uma linha por pessoa e contato (o tipo é valor, não coluna: nenhuma coluna de e-mail nova).
create table public.contact_visibility (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null
    constraint contact_visibility_kind_check check (kind in ('whatsapp', 'social', 'email')),
  scope text not null default 'none'
    constraint contact_visibility_scope_check check (scope in ('none', 'team', 'team_house')),
  updated_at timestamptz not null default now(),
  primary key (profile_id, kind)
);

comment on table public.contact_visibility is
  'Quem, além da coordenação, vê cada contato da pessoa (ADR 0010). Sem linha = ninguém.';

alter table public.contact_visibility enable row level security;

create trigger contact_visibility_set_updated_at
  before insert or update on public.contact_visibility
  for each row execute function app.tg_set_updated_at();

revoke all on public.contact_visibility from anon, authenticated;
grant select on public.contact_visibility to authenticated;

create policy contact_visibility_select on public.contact_visibility
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- Sem grant de escrita: estas políticas só documentam a regra (R5), como segunda barreira.
create policy contact_visibility_insert on public.contact_visibility
  for insert to authenticated
  with check (app.can_edit_profile(profile_id));

create policy contact_visibility_update on public.contact_visibility
  for update to authenticated
  using (app.can_edit_profile(profile_id))
  with check (app.can_edit_profile(profile_id));

-- A escolha de quem chama, para um contato. Vale na hora (a próxima leitura já usa).
create or replace function public.set_contact_visibility(p_kind text, p_scope text)
returns void
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
  if p_kind is null or p_kind not in ('whatsapp', 'social', 'email') then
    raise exception 'tipo de contato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_scope is null or p_scope not in ('none', 'team', 'team_house') then
    raise exception 'escolha inválida' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.profiles as p where p.id = caller)
     or not app.can_edit_profile(caller) then
    raise exception 'sem permissão para mudar esta escolha' using errcode = 'insufficient_privilege';
  end if;

  insert into public.contact_visibility (profile_id, kind, scope)
  values (caller, p_kind, p_scope)
  on conflict (profile_id, kind) do update set scope = excluded.scope;
end;
$$;

comment on function public.set_contact_visibility(text, text) is
  'Muda quem vê um contato de quem chama (none, team, team_house). Só a própria linha.';

revoke execute on function public.set_contact_visibility(text, text) from public, anon;
grant execute on function public.set_contact_visibility(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. app.can_view_contact(target, kind)
-- ---------------------------------------------------------------------------------------
-- Marcador explícito de equipe (revisão do #138): o tipo de unidade cujos membros são colegas
-- de equipe. Configuração da instância, como `membership_axis`; só no eixo `team`.
alter table public.unit_types
  add column is_team boolean not null default false,
  add constraint unit_types_is_team_axis check (not is_team or membership_axis = 'team');

comment on column public.unit_types.is_team is
  'Os membros de uma unidade deste tipo são colegas de equipe (ADR 0010). Só no eixo team.';

-- Instâncias que já existem: o tipo de chave `team` é a equipe (o seed novo já marca).
update public.unit_types set is_team = true where key = 'team' and membership_axis = 'team';

-- A escolha do alvo para um contato (`none` sem linha).
create or replace function app.contact_visibility_of(target uuid, kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select v.scope
    from public.contact_visibility as v
    where v.profile_id = target and v.kind = contact_visibility_of.kind
  ), 'none');
$$;

-- As regras de "mesma equipe", "mesma casa" e "coordenador da casa" ficam cada uma numa função
-- própria: o modelo de casa vai mudar (casa nacional, fora da árvore de território; ADR 0011,
-- em escrita), e a refatoração troca só o corpo de `shares_open_house` e de
-- `is_house_coordinator_of`, sem mexer em `can_view_contact` nem em `shares_contact_group`.
-- Recebem as duas pessoas explicitamente e por isso NÃO são chamáveis pela API (revelariam com
-- quem alguém divide equipe ou casa). A checagem de pessoas ativas fica em `can_view_contact`.

-- `a` e `b` têm vínculo aberto na mesma equipe (unidade ativa de um tipo `is_team`)?
create or replace function app.shares_open_team(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null and b is not null and a <> b
    and exists (
      select 1
      from public.unit_members as ma
      join public.unit_members as mb
        on mb.unit_id = ma.unit_id
       and mb.profile_id = b
       and mb.axis = 'team'
       and mb.left_at is null
      join public.units as u on u.id = ma.unit_id
      join public.unit_types as t on t.id = u.type_id
      where ma.profile_id = a
        and ma.axis = 'team'
        and ma.left_at is null
        and u.status = 'active'
        and t.is_team
    );
$$;

-- O território mais próximo da pessoa: pelo vínculo aberto do eixo `team`, a unidade acima da
-- equipe (a região) ou, sem equipe, a própria unidade do vínculo (região ou estado). Nulo sem
-- vínculo de território.
create or replace function app.home_territory(person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when t.is_team then u.parent_id else u.id end
  from public.unit_members as m
  join public.units as u on u.id = m.unit_id
  join public.unit_types as t on t.id = u.type_id
  where m.profile_id = person
    and m.axis = 'team'
    and m.left_at is null;
$$;

-- `a` e `b` são da mesma casa NA MESMA REGIÃO (revisão do #138)? Hoje a casa é uma unidade do
-- eixo `house` (#76). Exige:
-- - os dois vínculos de casa abertos e aceitos (sem aceite, não conta);
-- - os dois aceitos há pelo menos 7 dias (entrar na casa não dá acesso no mesmo dia);
-- - o mesmo território mais próximo (`home_territory`), que não pode ser nulo.
create or replace function app.shares_open_house(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null and b is not null and a <> b
    and coalesce(app.home_territory(a) = app.home_territory(b), false)
    and exists (
      select 1
      from public.unit_members as ma
      join public.unit_members as mb
        on mb.unit_id = ma.unit_id
       and mb.profile_id = b
       and mb.axis = 'house'
       and mb.left_at is null
       and mb.accepted_at <= now() - interval '7 days'
      where ma.profile_id = a
        and ma.axis = 'house'
        and ma.left_at is null
        and ma.accepted_at <= now() - interval '7 days'
    );
$$;

-- `viewer` coordena a casa de `target`? Hoje: monitor ou manager (papel ativo) na unidade da casa
-- aceita e aberta de `target`, ou acima dela (a regra de escopo do ADR 0005, como era antes).
create or replace function app.is_house_coordinator_of(viewer uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null and target is not null
    and exists (
      select 1
      from public.unit_members as m
      join public.units as hu on hu.id = m.unit_id
      join public.role_assignments as r
        on r.profile_id = viewer
       and r.revoked_at is null
       and r.role in ('monitor', 'manager')
      join public.units as ru on ru.id = r.unit_id
      where m.profile_id = target
        and m.axis = 'house'
        and m.left_at is null
        and app.membership_counts(m.axis, m.accepted_at)
        and hu.path operator(extensions.<@) ru.path
    );
$$;

-- Quem chama e o alvo dividem um vínculo que, pela escolha `scope` do alvo, dá acesso?
create or replace function app.shares_contact_group(target uuid, scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case scope
    when 'team' then app.shares_open_team((select auth.uid()), target)
    when 'team_house' then app.shares_open_team((select auth.uid()), target)
                        or app.shares_open_house((select auth.uid()), target)
    else false
  end;
$$;

create or replace function app.can_view_contact(target uuid, kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target is not null
    and coalesce(kind in ('whatsapp', 'social', 'email'), false)
    and (
      target = (select auth.uid())
      or (
        app.is_active_member()
        and app.is_active_profile(target)
        and (
          -- Coordenação do escopo (como antes; ADR 0002 e 0010): pelo território...
          exists (
            select 1
            from public.unit_members as m
            join public.units as u on u.id = m.unit_id
            where m.profile_id = target
              and m.axis = 'team'
              and m.left_at is null
              and app.has_scope_over(u.path, array['monitor', 'manager'])
          )
          -- ... ou pela casa (o coordenador da casa, #124).
          or app.is_house_coordinator_of((select auth.uid()), target)
          -- Colega, se a pessoa autorizou (ADR 0010).
          or app.shares_contact_group(target, app.contact_visibility_of(target, kind))
        )
      )
    );
$$;

comment on function app.can_view_contact(uuid, text) is
  'Pode ver o contato `kind` (whatsapp, social, email) de `target`? Titular, coordenação do escopo ou colega autorizado (ADR 0010).';

-- O contato de terceiros sai só por `view_contact` (auditado): a política de SELECT direta
-- fica só com o titular, e a versão antiga da função (sem o tipo) sai.
alter policy profile_contacts_select on public.profile_contacts
  using (profile_id = (select auth.uid()));

drop function app.can_view_contact(uuid);

revoke execute on function
  app.contact_visibility_of(uuid, text),
  app.shares_open_team(uuid, uuid),
  app.home_territory(uuid),
  app.shares_open_house(uuid, uuid),
  app.is_house_coordinator_of(uuid, uuid),
  app.shares_contact_group(uuid, text),
  app.can_view_contact(uuid, text)
from public, anon;

-- As funções auxiliares só servem a `can_view_contact`: chamadas soltas revelariam a escolha de
-- outra pessoa, com quem ela divide equipe ou casa, ou quem coordena quem.
revoke execute on function
  app.contact_visibility_of(uuid, text),
  app.shares_open_team(uuid, uuid),
  app.home_territory(uuid),
  app.shares_open_house(uuid, uuid),
  app.is_house_coordinator_of(uuid, uuid),
  app.shares_contact_group(uuid, text)
from authenticated;

grant execute on function app.can_view_contact(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. audit_log: o tipo do contato em `reason`
-- ---------------------------------------------------------------------------------------
alter table public.audit_log
  drop constraint audit_log_reason_by_event,
  -- `coalesce`: num CHECK, `null in (...)` dá nulo e passaria; o motivo é obrigatório nesses
  -- eventos (a versão anterior deixava passar o nulo, sem que nenhuma função o gravasse).
  add constraint audit_log_reason_by_event check (
    case
      when event in ('access_granted', 'access_blocked') then coalesce(reason in ('manual', 'import'), false)
      when event = 'house_accepted' then coalesce(reason in ('self', 'questionnaire'), false)
      when event = 'contact_viewed' then coalesce(reason in ('whatsapp', 'social', 'email'), false)
      else reason is null
    end
  );

-- "Quem acessou o meu contato" (alvo + evento, do mais recente).
create index audit_log_target_event_created_idx
  on public.audit_log (target_id, event, created_at desc);

-- ---------------------------------------------------------------------------------------
-- 3. view_contact: a única leitura do contato de terceiros
-- ---------------------------------------------------------------------------------------
-- Devolve o valor guardado (WhatsApp e redes cifrados; o e-mail como está em auth.users) ou
-- nulo se a pessoa não tem aquele contato. Sem permissão: erro 42501, sem registro. O próprio
-- titular lê sem registro (não é acesso de terceiros). Revisão do #138:
-- - registra só quando há valor (nulo = nada foi visto);
-- - o mesmo ator vendo o mesmo tipo da mesma pessoa em 10 minutos gera um registro só;
-- - no máximo 60 pessoas distintas por hora por quem chama (erro 54000,
--   `program_limit_exceeded`); rever quem já entrou na conta da hora não gasta o limite. O lock
--   por quem chama impede que pedidos simultâneos passem do limite (como `export_own_data`).
--   O contador é o próprio audit_log, pelo índice `audit_log_actor_event_created_idx`
--   (`actor_id, event, created_at`, da #20), que também serve a leitura em ordem decrescente.
create or replace function public.view_contact(p_target uuid, p_kind text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  max_people_per_hour constant integer := 60;
  result text;
begin
  if caller is null then
    raise exception 'sessão obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if p_kind is null or p_kind not in ('whatsapp', 'social', 'email') then
    raise exception 'tipo de contato inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_target is null or not app.can_view_contact(p_target, p_kind) then
    raise exception 'sem permissão para ver este contato' using errcode = 'insufficient_privilege';
  end if;

  if p_target <> caller then
    perform pg_advisory_xact_lock(hashtextextended('view_contact:' || caller::text, 0));
    if not exists (
      select 1 from public.audit_log as a
      where a.actor_id = caller
        and a.event = 'contact_viewed'
        and a.target_id = p_target
        and a.created_at > now() - interval '1 hour'
    ) and (
      select count(distinct a.target_id) from public.audit_log as a
      where a.actor_id = caller
        and a.event = 'contact_viewed'
        and a.created_at > now() - interval '1 hour'
    ) >= max_people_per_hour then
      raise exception 'limite de contatos vistos por hora atingido'
        using errcode = 'program_limit_exceeded';
    end if;
  end if;

  if p_kind = 'whatsapp' then
    select c.whatsapp_enc into result from public.profile_contacts as c where c.profile_id = p_target;
  elsif p_kind = 'social' then
    select c.social_links_enc into result from public.profile_contacts as c where c.profile_id = p_target;
  else
    select u.email::text into result from auth.users as u where u.id = p_target;
  end if;

  if result is not null
     and p_target <> caller
     and not exists (
       select 1 from public.audit_log as a
       where a.actor_id = caller
         and a.event = 'contact_viewed'
         and a.target_id = p_target
         and a.reason = p_kind
         and a.created_at > now() - interval '10 minutes'
     ) then
    insert into public.audit_log (actor_id, event, target_id, reason)
    values (caller, 'contact_viewed', p_target, p_kind);
  end if;
  return result;
end;
$$;

comment on function public.view_contact(uuid, text) is
  'Ver contato (ADR 0010): aplica app.can_view_contact, grava contact_viewed (só com valor; 1 por 10 min), até 60 pessoas por hora; devolve o valor guardado (cifrado, menos o e-mail).';

revoke execute on function public.view_contact(uuid, text) from public, anon;
grant execute on function public.view_contact(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Quem acessou o meu contato
-- ---------------------------------------------------------------------------------------
-- Os 200 acessos mais recentes ao contato de quem chama. `viewer_id` serve só ao servidor,
-- para decifrar o nome (o AAD é o id da linha, ADR 0003); a tela e o arquivo mostram o nome.
-- Conta excluída: nome nulo.
create or replace function public.list_contact_views()
returns table (viewer_id uuid, viewer_name_enc text, kind text, viewed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.actor_id, p.display_name_enc, a.reason, a.created_at
  from public.audit_log as a
  left join public.profiles as p on p.id = a.actor_id
  where a.target_id = (select auth.uid())
    and a.event = 'contact_viewed'
  order by a.created_at desc, a.id desc
  limit 200;
$$;

comment on function public.list_contact_views() is
  'Quem acessou o contato de quem chama (ADR 0010): nome cifrado de quem viu, tipo e quando.';

revoke execute on function public.list_contact_views() from public, anon;
grant execute on function public.list_contact_views() to authenticated;

-- "Baixar meus dados" (#20) passa a trazer quem acessou o contato (a mesma lista, sem limite).
-- Definição igual à de `..._export_own_data.sql`, com a chave `contact_views` no fim.
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
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', r.role,
        'unit_name', u.name,
        'unit_type', t.label,
        'granted_at', r.granted_at,
        'revoked_at', r.revoked_at
      ) order by r.granted_at, r.id)
      from public.role_assignments as r
      join public.units as u on u.id = r.unit_id
      join public.unit_types as t on t.id = u.type_id
      where r.profile_id = caller
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', a.event,
        'reason', a.reason,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.audit_log as a
      where a.target_id = caller
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

comment on function public.export_own_data() is
  'Dados da própria pessoa para o "Baixar meus dados" (#20), ainda cifrados, com quem acessou o contato (#119). Registra data_exported; até 5 por hora.';
