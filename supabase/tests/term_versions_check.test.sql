-- #222: o healthz confere, só com leitura, que as versões do termo da config existem no banco.
-- `public.term_versions_check` devolve só 'ok' ou o motivo; a tabela segue sem acesso pela API.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into app.questionnaire_term_versions (version) values ('termo-teste-222');

select is(public.term_versions_check('termo-teste-222', app.current_consent_version()), 'ok',
  'versão do questionário e do termo geral existem: ok');
select is(public.term_versions_check('termo-que-nao-existe', app.current_consent_version()), 'questionnaire_missing',
  'versão do questionário ausente da tabela: questionnaire_missing');
select is(public.term_versions_check('termo-teste-222', 'v999'), 'consent_mismatch',
  'termo geral diferente da versão vigente do banco: consent_mismatch');
select is(public.term_versions_check('termo-que-nao-existe', 'v999'), 'questionnaire_missing',
  'os dois errados: o do questionário é dito primeiro');
select is(public.term_versions_check(null, null), 'questionnaire_missing', 'nulo não passa por ok');

select ok(has_function_privilege('anon', 'public.term_versions_check(text, text)', 'execute'),
  'o healthz roda com a chave anon: anon executa a função');
select ok(has_function_privilege('authenticated', 'public.term_versions_check(text, text)', 'execute'),
  'authenticated também');
select ok(not has_table_privilege('anon', 'app.questionnaire_term_versions', 'select'),
  'a tabela de versões continua sem leitura pela API (anon)');
select ok(not has_table_privilege('authenticated', 'app.questionnaire_term_versions', 'select'),
  'a tabela de versões continua sem leitura pela API (authenticated)');

select * from finish();
rollback;
