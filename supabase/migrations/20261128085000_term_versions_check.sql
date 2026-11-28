-- #222: o healthz confere que as versões do termo da config existem no banco.
--
-- O staging subiu com `app.questionnaire_term_versions` vazia e o aceite do termo do questionário era
-- recusado em silêncio. A tabela não tem acesso pela API (e segue assim); esta função só LÊ e devolve
-- 'ok' ou 'degraded', sem dizer qual das duas versões falhou nem listar versões:
--   - a versão do termo do questionário precisa estar em `app.questionnaire_term_versions`;
--   - a do termo geral precisa ser a vigente (`app.current_consent_version()`).
-- Executável por `anon`: o healthz roda sem login, só com a chave anon, e o app não tem chave de serviço (R6).
-- Quem chamar só aprende se um PAR de versões que já conhece bate com o banco, e o par inclui a do termo
-- geral, que é pública (aparece no termo mostrado). Só aceita o formato validado das versões.
create or replace function public.term_versions_check(p_questionnaire text, p_general text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_questionnaire ~ '^[A-Za-z0-9._-]{1,32}$'
      and p_general ~ '^[A-Za-z0-9._-]{1,32}$'
      and p_general = app.current_consent_version()
      and exists (select 1 from app.questionnaire_term_versions as v where v.version = p_questionnaire)
      then 'ok'
    else 'degraded'
  end
$$;

revoke execute on function public.term_versions_check(text, text) from public;
grant execute on function public.term_versions_check(text, text) to anon, authenticated;

comment on function public.term_versions_check(text, text) is
  'Só leitura: confere as versões do termo da config no banco (#222). Devolve ok ou degraded, nunca versões nem qual falhou.';

notify pgrst, 'reload schema';
