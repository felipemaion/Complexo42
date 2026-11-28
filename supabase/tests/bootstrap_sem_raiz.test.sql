-- Bootstrap da primeira coordenação num banco SEM estrutura (issue do staging, follow-up do #295):
-- sem unidade raiz a função diz o que fazer, em vez de `no_data_found`. Só dentro desta transação.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

-- Banco "vazio": apaga a árvore (do mais fundo para a raiz); o seed local não tem pessoa nem papel.
do $$
declare
  n integer;
begin
  loop
    delete from public.units u
    where not exists (select 1 from public.units c where c.parent_id = u.id);
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
end $$;
select is((select count(*)::int from public.units), 0, 'sem unidades (banco sem estrutura)');

select throws_ok(
  format($$ select app.bootstrap_root_manager(%L, 'novo@exemplo.org', false) $$,
    encode(sha256(convert_to('novo@exemplo.org', 'UTF8')), 'hex')),
  'P0001',
  'a instância não tem unidade raiz; aplique primeiro a estrutura da instância (docs/OPERACAO.md)',
  'sem raiz: mensagem clara de que falta a estrutura (nada de no_data_found)');

select * from finish();
rollback;
