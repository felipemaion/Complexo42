-- "Baixar meus dados" (issue #20; LGPD art. 18, II e V: acesso e portabilidade).
--
-- 1. `public.export_own_data()`, `security definer`: devolve, num jsonb, tudo o que o banco
--    guarda sobre QUEM CHAMA (`auth.uid()`), e nada de mais ninguém. O servidor chama com o
--    JWT da pessoa (R14) e decifra nome, WhatsApp e redes em src/server/crypto (R13): aqui os
--    valores saem ainda cifrados. Por que uma função e não leituras com RLS: a RLS esconde da
--    própria pessoa os vínculos encerrados (a unidade antiga deixa de ser visível), os papéis
--    de quem não está ativo e toda a auditoria (só gestores leem). O direito de acesso vale
--    para tudo isso. A função lê só linhas da própria pessoa, então não abre nada de terceiros.
--
--    Fica de fora (dado interno, não é "sobre a pessoa" no sentido útil, ou é de terceiros):
--    - `whatsapp_hmac` e os HMACs de e-mail (`access_allowlist`, `access_waitlist_hmac`):
--      índices cegos calculados com a chave do servidor; não revelam nada à pessoa e só
--      serviriam para testar números ou e-mails alheios;
--    - `granted_by` dos papéis e `actor_id` da auditoria: ids de outras pessoas. Quem acessou
--      o contato (ADR 0010, "a pessoa pode ver quem acessou") entra com a #119, que define o
--      que mostrar de quem viu;
--    - colegas dos vínculos: só o nome e o tipo da unidade.
--
-- 2. Auditoria e limite: cada exportação grava `data_exported` (ator e alvo = a pessoa) ANTES
--    de montar o resultado, e a função recusa a 6ª exportação na mesma hora (erro 54000,
--    `program_limit_exceeded`). O próprio audit_log (só inserções) é o contador: não precisa
--    de tabela nova, e ninguém zera o limite apagando linhas. O lock por pessoa evita que
--    pedidos simultâneos passem do limite. O evento não leva dado pessoal; os gestores com
--    escopo sobre a pessoa o leem pelas regras de sempre (`app.can_read_audit`).

alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported'
));

-- Índice do contador do limite (pessoa + evento + hora).
create index audit_log_actor_event_created_idx
  on public.audit_log (actor_id, event, created_at);

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
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.export_own_data() is
  'Dados da própria pessoa para o "Baixar meus dados" (#20), ainda cifrados. Registra data_exported; até 5 por hora.';

revoke execute on function public.export_own_data() from public, anon;
grant execute on function public.export_own_data() to authenticated;
