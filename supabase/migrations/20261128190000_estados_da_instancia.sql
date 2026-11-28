-- Os 27 estados, por migration (#365).
--
-- Num banco só com migrations não havia nenhuma unidade de estado (a estrutura do #300 cria só a raiz, os tipos,
-- as casas e as habilidades, e deixava "a árvore abaixo da raiz" para o operador). Sem a unidade do estado, o
-- gatilho `app.tg_join_state_unit()` não vincula ninguém, e `app.can_view_profile()` só deixa a coordenação ler
-- OUTRA pessoa que tenha um vínculo aberto numa unidade do escopo dela: a lista de resultados mostrava "sem nome"
-- para todo mundo, menos para a própria coordenação (achado no "Staging de mentira").
--
-- Os estados são iguais em toda instalação (UF, slug e nome fixos), então entram aqui. Regiões e equipes continuam
-- por conta do operador (docs/OPERACAO.md). Idempotente e sem sobrescrever: estado que o operador já criou (mesma UF,
-- ou o mesmo slug abaixo da raiz) fica como está.

-- ---------------------------------------------------------------------------------------
-- 1. As 27 unidades de estado, filhas da raiz nacional
-- ---------------------------------------------------------------------------------------
insert into public.units (type_id, parent_id, slug, name, state_code, path)
select t.id, r.id, lower(s.uf), s.name, s.uf, lower(s.uf)::extensions.ltree
from (values
  ('AC', 'Acre'), ('AL', 'Alagoas'), ('AP', 'Amapá'), ('AM', 'Amazonas'), ('BA', 'Bahia'),
  ('CE', 'Ceará'), ('DF', 'Distrito Federal'), ('ES', 'Espírito Santo'), ('GO', 'Goiás'),
  ('MA', 'Maranhão'), ('MT', 'Mato Grosso'), ('MS', 'Mato Grosso do Sul'), ('MG', 'Minas Gerais'),
  ('PA', 'Pará'), ('PB', 'Paraíba'), ('PR', 'Paraná'), ('PE', 'Pernambuco'), ('PI', 'Piauí'),
  ('RJ', 'Rio de Janeiro'), ('RN', 'Rio Grande do Norte'), ('RS', 'Rio Grande do Sul'),
  ('RO', 'Rondônia'), ('RR', 'Roraima'), ('SC', 'Santa Catarina'), ('SP', 'São Paulo'),
  ('SE', 'Sergipe'), ('TO', 'Tocantins')
) as s (uf, name)
join public.unit_types as t on t.key = 'state'
join public.units as r on r.parent_id is null
where not exists (select 1 from public.units as u where u.state_code = s.uf)
  and not exists (select 1 from public.units as u where u.parent_id = r.id and u.slug = lower(s.uf));

-- ---------------------------------------------------------------------------------------
-- 2. Auditoria: um evento de sistema, só com a contagem
-- ---------------------------------------------------------------------------------------
-- (Esta lista repete a vigente em `20261128120000_skill_search.sql` e acrescenta o evento novo.)
alter table public.audit_log drop constraint audit_log_event_check;
alter table public.audit_log add constraint audit_log_event_check check (event in (
  'contact_viewed', 'role_granted', 'role_revoked', 'member_moved', 'logo_approved',
  'export', 'badge_granted', 'badge_revoked', 'submission_approved',
  'submission_rejected', 'points_adjusted', 'account_deleted',
  'allowlist_imported', 'access_granted', 'access_blocked', 'data_exported',
  'house_accepted', 'questionnaire_consented', 'consent_accepted',
  'member_blocked', 'member_unblocked',
  'house_analysis_requested', 'house_analysis_resolved',
  'questionnaire_access_granted', 'questionnaire_access_revoked',
  'questionnaire_result_viewed', 'house_changed',
  'house_window_opened', 'house_window_closed',
  'skill_suggestion_decided', 'skill_reactivated',
  'skills_searched',
  'members_attached_to_state'
));

-- A contagem (`item_count`) era só do lote da lista de autorizados; o evento novo também é um lote.
alter table public.audit_log drop constraint audit_log_item_count_only_for_batches;
alter table public.audit_log add constraint audit_log_item_count_only_for_batches
  check ((event in ('allowlist_imported', 'members_attached_to_state')) = (item_count is not null));

-- ---------------------------------------------------------------------------------------
-- 3. Quem já estava ativo sem vínculo entra no estado dele
-- ---------------------------------------------------------------------------------------
-- O gatilho só age quando o município muda: quem completou o perfil ANTES de a unidade do estado existir ficou
-- sem vínculo. Só `active` com perfil completo e SEM nenhum vínculo aberto (quem já está numa região ou equipe fica
-- onde está, como no gatilho). Devolve quantas pessoas vinculou e, se alguma, grava um evento de sistema com a
-- contagem (sem ator, sem alvo, sem dado pessoal). Idempotente.
create or replace function app.attach_active_members_to_state()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  attached integer;
begin
  with moved as (
    insert into public.unit_members (unit_id, profile_id)
    select u.id, p.id
    from public.profiles as p
    join public.units as u on u.state_code = p.state_code and u.status = 'active'
    where p.access_status = 'active'
      and p.profile_completed_at is not null
      and not exists (select 1 from public.unit_members as m where m.profile_id = p.id and m.left_at is null)
    returning 1
  )
  select count(*)::integer into attached from moved;

  if attached > 0 then
    insert into public.audit_log (event, item_count) values ('members_attached_to_state', attached);
  end if;
  return attached;
end;
$$;

revoke execute on function app.attach_active_members_to_state() from public, anon, authenticated;

comment on function app.attach_active_members_to_state() is
  'Vincula ao estado quem está ativo, com perfil completo e sem vínculo aberto (#365). Idempotente; grava a contagem no audit_log.';

select app.attach_active_members_to_state();
