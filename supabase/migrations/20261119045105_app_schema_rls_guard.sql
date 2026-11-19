-- Fundação do banco (issue #4).
-- 1. Schema `app`: abriga as funções de acesso `app.can_*` (ADR 0002) e utilitários internos.
--    Não é exposto pela API (fora de [api].schemas no config.toml).
-- 2. `app.tables_without_rls()`: lista as tabelas sem Row Level Security. O teste pgTAP
--    `supabase/tests/rls_enabled.test.sql` falha se ela devolver qualquer linha.
-- Só depende do Postgres puro: nenhuma extensão além das de deploy/initdb.

create schema if not exists app;

revoke all on schema app from public;
-- As políticas RLS chamam funções de `app` com o papel de quem consulta.
grant usage on schema app to anon, authenticated, service_role;

create or replace function app.tables_without_rls(
  target_schemas text[] default array['public', 'app']
)
returns table (schema_name name, table_name name)
language sql
stable
set search_path = ''
as $$
  select t.schemaname, t.tablename
  from pg_catalog.pg_tables as t
  where t.schemaname = any (target_schemas)
    and not t.rowsecurity
  order by 1, 2;
$$;

comment on function app.tables_without_rls(text[]) is
  'Tabelas dos schemas informados sem RLS habilitada. Deve ser sempre vazio (R5).';

-- Utilitário de checagem: não é para clientes da API.
revoke execute on function app.tables_without_rls(text[]) from public, anon, authenticated;
