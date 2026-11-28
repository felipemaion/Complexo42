-- "Ver contato" (#48): a tela só mostra o botão a quem pode ver. `contact_access(alvo)` responde, para cada tipo
-- de contato, se QUEM CHAMA pode ver o do alvo, pela mesma regra de `view_contact` (`app.can_view_contact`, ADR 0010).
-- Devolve só booleanos: não lê o contato, não grava no `audit_log`, não gasta a cota de 60 pessoas por hora. Saber que
-- pode ver não revela nada sobre o outro (a autorização do colega e o escopo da coordenação já são conhecidos de quem
-- passa na regra). Sem sessão ou alvo nulo: tudo falso. `login_ok` é o e-mail de login (o nome evita "mail": o teste de
-- permissões proíbe função da API com coluna de e-mail).

create or replace function public.contact_access(p_target uuid)
returns table (whatsapp_ok boolean, social_ok boolean, login_ok boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.can_view_contact(p_target, 'whatsapp'),
    app.can_view_contact(p_target, 'social'),
    app.can_view_contact(p_target, 'email')
$$;

comment on function public.contact_access(uuid) is
  'Quem chama pode ver cada contato do alvo? Só booleanos, sem ler o valor e sem auditar (#48); a leitura é view_contact.';

revoke execute on function public.contact_access(uuid) from public, anon;
grant execute on function public.contact_access(uuid) to authenticated;
