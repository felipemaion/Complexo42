- **Totem para os membros (#303):** `public.member_totems(pessoas)` (security definer, até 200) devolve a quem é membro
  ativo só `(profile_id, totem_enc)` de pessoas ativas com totem definido; nunca notas, respostas nem assinatura. Quem
  decifra é o servidor do app (AAD `questionnaire_results.totem_enc.<id>`), e o navegador recebe só o código. A RLS da
  tabela não muda. Ver ADR 0014 (revisão de 28/11).
