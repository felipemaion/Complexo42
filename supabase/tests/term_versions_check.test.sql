-- #222: o healthz confere, só com leitura, que as versões do termo da config existem no banco.
-- `public.term_versions_check` devolve só 'ok' ou 'degraded' (nunca qual versão falhou); a tabela segue sem acesso pela API.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into app.questionnaire_term_versions (version) values ('termo-teste-222');

select is(public.term_versions_check('termo-teste-222', app.current_consent_version()), 'ok',
  'versão do questionário e do termo geral existem: ok');
select is(public.term_versions_check('termo-que-nao-existe', app.current_consent_version()), 'degraded',
  'versão do questionário ausente da tabela: degraded');
select is(public.term_versions_check('termo-teste-222', 'v999'), 'degraded',
  'termo geral diferente da versão vigente do banco: degraded (sem dizer qual das duas falhou)');
select is(public.term_versions_check('termo-que-nao-existe', 'v999'), 'degraded',
  'os dois errados: degraded');
select is(public.term_versions_check(null, null), 'degraded', 'nulo não passa por ok');
select is(public.term_versions_check('com espaço', app.current_consent_version()), 'degraded', 'formato inválido não passa por ok');
select is(public.term_versions_check(repeat('a', 33), app.current_consent_version()), 'degraded', 'mais de 32 caracteres não passa por ok');

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
