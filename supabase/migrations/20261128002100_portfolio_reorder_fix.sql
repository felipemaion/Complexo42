-- Conserto do portfólio (#70): ao tirar um item, a renumeração dos de baixo podia esbarrar em
-- "chave repetida" (23505) quando as linhas estão guardadas fora de ordem, e a pessoa não
-- conseguia tirar o item. A regra de posição única passa a ser conferida no fim do comando.
-- Teste: supabase/tests/portfolio.test.sql ("linhas guardadas fora de ordem").

alter table public.portfolio_items
  drop constraint portfolio_items_profile_id_position_key,
  add constraint portfolio_items_profile_id_position_key unique (profile_id, position) deferrable initially immediate;
