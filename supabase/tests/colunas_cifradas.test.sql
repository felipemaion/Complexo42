-- Dado pessoal só existe cifrado (#155, ADR 0003, R13). Duas guardas sobre o ESQUEMA REAL (o `check-forbidden-fields.sh` só lê o
-- texto das migrations):
--   1. toda coluna `*_enc` de tabela de `public` e `app` tem um CHECK com `app.is_encrypted_value` (a forma do valor cifrado);
--      coluna cifrada nova sem o CHECK deixaria gravar texto puro sem ninguém notar;
--   2. nenhuma coluna de dado pessoal existe sem o sufixo `_enc` (cifrada) ou `_hmac` (índice cego). A lista é a do
--      docs/MODELO_DADOS.md: nome, WhatsApp, redes, bairro, formação, atividade, foto, e-mail. `name` solto fica de fora de
--      propósito: é o nome de unidade, casa e habilidade, que não é dado de pessoa.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select cmp_ok(
  (select count(*)::int from information_schema.columns c
   join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema in ('public', 'app') and c.column_name like E'%\\_enc'),
  '>=', 10, 'a guarda enxerga as colunas cifradas (sanidade: o esquema tem pelo menos 10)'
);

select is_empty(
  $$ select c.table_schema || '.' || c.table_name || '.' || c.column_name as coluna_sem_check
     from information_schema.columns c
     join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema in ('public', 'app') and c.column_name like E'%\\_enc'
       and not exists (
         select 1 from pg_constraint k
         where k.conrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
           and k.contype = 'c'
           and pg_get_constraintdef(k.oid) like '%is_encrypted_value%'
           and pg_get_constraintdef(k.oid) like '%' || c.column_name || '%'
       )
     order by 1 $$,
  'toda coluna *_enc tem um CHECK com app.is_encrypted_value (coluna nova precisa do CHECK)'
);

select is_empty(
  $$ select c.table_schema || '.' || c.table_name || '.' || c.column_name as dado_pessoal_em_claro
     from information_schema.columns c
     join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema in ('public', 'app')
       and c.column_name ~ '^(display_name|full_name|nome|whatsapp|phone|telefone|celular|e_?mail|social_links|redes|neighborhood|bairro|occupation|ocupacao|education_level|education_detail|formacao|photo|foto|avatar|avatar_url)$'
     order by 1 $$,
  'nenhuma coluna de dado pessoal sem o sufixo _enc ou _hmac (nome, whatsapp, redes, bairro, formação, atividade, foto, e-mail)'
);

-- Prova de que a guarda 1 enxerga o problema: uma coluna `_enc` sem o CHECK aparece.
create table public.coluna_cifrada_sem_check (id int, segredo_enc text);
select set_eq(
  $$ select c.table_name || '.' || c.column_name
     from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'coluna_cifrada_sem_check' and c.column_name like E'%\\_enc'
       and not exists (
         select 1 from pg_constraint k
         where k.conrelid = 'public.coluna_cifrada_sem_check'::regclass and k.contype = 'c'
           and pg_get_constraintdef(k.oid) like '%is_encrypted_value%'
       ) $$,
  array['coluna_cifrada_sem_check.segredo_enc'],
  'a guarda aponta uma coluna *_enc sem o CHECK'
);

select * from finish();
rollback;
