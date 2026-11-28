-- Matriz declarativa de privilégio por tabela (#154, parte a; AGENTS.md R5 e R16).
--
-- Cada tabela de `public` precisa de UMA linha em `declared`: as operações (S select, I insert, U update, D delete)
-- que `anon` e `authenticated` podem fazer na tabela. Letra minúscula é privilégio só em coluna (`s`). O que não está
-- listado é negado. O teste lê o catálogo e
-- falha fechado:
--   * tabela existente sem linha, ou linha de tabela que não existe;
--   * privilégio real diferente do declarado (inclusive o aberto demais);
--   * operação concedida a `authenticated` sem nenhuma política que a permita (concessão morta).
-- Tabela nova ou privilégio novo sem linha aqui reprova o CI: a pessoa que a cria decide o que é permitido.
-- A leitura por escopo (dentro e fora, por papel) é a parte (b), em arquivo próprio.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

create temp table declared (tbl text primary key, anon_ops text not null, auth_ops text not null);
-- tbl | anon | authenticated
insert into declared values
  ('access_allowlist', '', ''),
  ('access_waitlist_hmac', '', ''),
  ('audit_log', '', 'S'),
  ('consent_acceptances', '', 'S'),
  ('contact_visibility', '', 'S'),
  ('districts', '', 'S'),
  ('house_analysis_requests', '', 'S'),
  ('house_members', '', 'Su'),
  ('house_transfer_window', '', 's'),
  ('houses', '', 'S'),
  ('municipalities', '', 'S'),
  ('news', '', 's'),
  ('profile_background', '', 'Siu'),
  ('profile_badge_prefs', '', 'S'),
  ('profile_contacts', '', 'S'),
  ('profile_photos', '', 'SD'),
  ('profile_skills', '', 'S'),
  ('profiles', '', 'S'),
  ('questionnaire_consents', '', 'S'),
  ('questionnaire_data_grants', '', 'S'),
  ('questionnaire_results', '', 's'),
  ('role_assignments', '', 'Siu'),
  ('skill_suggestions', '', 'S'),
  ('skills', '', 'S'),
  ('unit_members', '', 'Su'),
  ('unit_types', '', 'S'),
  ('units', '', 'Su');

create function pg_temp.ops(p_role text, p_oid oid) returns text language sql stable as $$
  select coalesce(string_agg(
    case when has_table_privilege(p_role, p_oid, x.priv) then x.op
         when has_any_column_privilege(p_role, p_oid, x.priv) then lower(x.op) end,
    '' order by x.ord), '')
  from (values ('S', 1, 'select'), ('I', 2, 'insert'), ('U', 3, 'update')) as x(op, ord, priv)
$$;
create function pg_temp.table_ops(p_role text, p_oid oid) returns text language sql stable as $$
  select pg_temp.ops(p_role, p_oid) || case when has_table_privilege(p_role, p_oid, 'delete') then 'D' else '' end
$$;

create temp table actual as
select c.relname::text as tbl,
  pg_temp.table_ops('anon', c.oid) as anon_ops,
  pg_temp.table_ops('authenticated', c.oid) as auth_ops,
  c.relrowsecurity as rls
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p');

select is_empty(
  $$ select coalesce(a.tbl, d.tbl) as tbl, case when d.tbl is null then 'sem linha na declaração' else 'tabela não existe' end as problema
     from actual as a full join declared as d on d.tbl = a.tbl
     where a.tbl is null or d.tbl is null $$,
  'toda tabela de public está declarada, e só elas (falha fechado)'
);

select is_empty(
  $$ select a.tbl, a.anon_ops as anon_real, d.anon_ops as anon_declarado, a.auth_ops as auth_real, d.auth_ops as auth_declarado
     from actual as a join declared as d on d.tbl = a.tbl
     where a.anon_ops <> d.anon_ops or a.auth_ops <> d.auth_ops $$,
  'o privilégio real de anon e authenticated é o declarado'
);

select is_empty(
  $$ select tbl from actual where not rls $$,
  'toda tabela declarada tem RLS ligada'
);

-- Concessão morta: `authenticated` tem a operação, mas nenhuma política a permite (nem `to public`).
select is_empty(
  $$ select a.tbl, o.op
     from actual as a
     cross join (values ('S', 'SELECT'), ('I', 'INSERT'), ('U', 'UPDATE'), ('D', 'DELETE')) as o(op, cmd)
     where position(o.op in upper(a.auth_ops)) > 0
       and not exists (
         select 1 from pg_policies as p
         where p.schemaname = 'public' and p.tablename = a.tbl and p.cmd in (o.cmd, 'ALL')
           and (p.roles && array['authenticated', 'public']::name[])
       ) $$,
  'toda operação concedida a authenticated tem política que a permita'
);

select * from finish();
rollback;
