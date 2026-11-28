  **A própria linha (#318):** a RLS (`app.can_read_questionnaire_data`) deixa a pessoa ler o próprio resultado só
  enquanto ela está em onboarding (`app.is_onboarding_member()`: liberada pela lista), não "qualquer membro". As
  funções `coordination_chosen_houses`, `coordination_other_house_results` e `log_questionnaire_view` incluem quem
  chama apenas se for da coordenação (`app.manages_root()` ou `app.holds_questionnaire_grant()`); quem não é
  não recebe a própria linha nem grava auditoria sobre si.
