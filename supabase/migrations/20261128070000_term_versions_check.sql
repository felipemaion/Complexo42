-- #222: o healthz confere que as versões do termo da config existem no banco.
--
-- O staging subiu com `app.questionnaire_term_versions` vazia e o aceite do termo do questionário era
-- recusado em silêncio. A tabela não tem acesso pela API (e segue assim); esta função só LÊ e devolve
-- um motivo curto, nunca a lista de versões:
--   'ok'                    as duas versões existem;
--   'questionnaire_missing' a versão do termo do questionário não está na tabela;
--   'consent_mismatch'      a versão do termo geral da config não é a vigente no banco
--                           (`app.current_consent_version()`).
-- Executável por `anon`: o healthz roda sem login, só com a chave anon. Quem chamar só descobre se uma
-- versão que já sabe existe ou não; as versões do termo não são segredo (aparecem no termo mostrado).
create or replace function public.term_versions_check(p_questionnaire text, p_general text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_questionnaire is null
      or not exists (select 1 from app.questionnaire_term_versions as v where v.version = p_questionnaire)
      then 'questionnaire_missing'
    when p_general is distinct from app.current_consent_version() then 'consent_mismatch'
    else 'ok'
  end
$$;

revoke execute on function public.term_versions_check(text, text) from public;
grant execute on function public.term_versions_check(text, text) to anon, authenticated;

comment on function public.term_versions_check(text, text) is
  'Só leitura: confere as versões do termo da config no banco (#222). Devolve ok ou o motivo, nunca versões.';

notify pgrst, 'reload schema';
