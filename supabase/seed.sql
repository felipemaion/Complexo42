-- Seed da instância piloto (issue #46, ADR 0008 §2). Só dados fictícios e de estrutura:
-- nenhuma pessoa, nenhum papel. Roda no `supabase db reset` e no `supabase start`.
--
-- Árvore: nacional → estado → região (incubadora) → casas e equipes.
-- Os rótulos exibidos vêm de `unit_types.label` (R17): o código nunca usa estes nomes.

-- `membership_axis` (ADR 0008 §2): o vínculo com uma casa é de outro eixo; os demais tipos são
-- do eixo territorial/equipe.
insert into public.unit_types (key, label, level, membership_axis) values
  ('national', 'Nacional', 0, 'team'),
  ('state', 'Estado', 1, 'team'),
  ('region', 'Região', 2, 'team'),
  ('house', 'Casa', 3, 'house'),
  ('team', 'Equipe', 3, 'team');

-- O tipo cujos membros são colegas de equipe (ADR 0010, #119).
update public.unit_types set is_team = true where key = 'team';

-- Insere uma unidade abaixo do pai indicado pelo `path`; o trigger calcula o `path` dela.
create function pg_temp.seed_unit(
  p_type text, p_parent text, p_slug text, p_name text, p_state char(2) default null
)
returns void
language sql
as $$
  insert into public.units (type_id, parent_id, slug, name, state_code, path)
  select t.id, p.id, p_slug, p_name, p_state, p_slug::extensions.ltree
  from public.unit_types as t
  left join public.units as p on p.path = p_parent::extensions.ltree
  where t.key = p_type;
$$;

select pg_temp.seed_unit('national', null, 'br', 'Nacional');

select pg_temp.seed_unit('state', 'br', 'sp', 'São Paulo', 'SP');
select pg_temp.seed_unit('state', 'br', 'mg', 'Minas Gerais', 'MG');

select pg_temp.seed_unit('region', 'br.sp', 'abc', 'Incubadora ABC');
select pg_temp.seed_unit('region', 'br.sp', 'zona_leste', 'Incubadora Zona Leste');
select pg_temp.seed_unit('region', 'br.mg', 'central', 'Incubadora Central');

-- Casas: o slug é o `id` da casa em config/instance.ts com `_` no lugar de `-` (#76). A
-- região piloto tem as quatro; tests/house-units.test.ts confere seed e config juntos.
select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_exemplo_1', 'Casa Exemplo Um');
select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_exemplo_2', 'Casa Exemplo Dois');
select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_exemplo_3', 'Casa Exemplo Três');
select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_exemplo_4', 'Casa Exemplo Quatro');
select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_1', 'Equipe 1');
select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_2', 'Equipe 2');

select pg_temp.seed_unit('house', 'br.sp.zona_leste', 'casa_exemplo_1', 'Casa Exemplo Um');
select pg_temp.seed_unit('team', 'br.sp.zona_leste', 'equipe_1', 'Equipe 1');

select pg_temp.seed_unit('house', 'br.mg.central', 'casa_exemplo_1', 'Casa Exemplo Um');
select pg_temp.seed_unit('team', 'br.mg.central', 'equipe_1', 'Equipe 1');

-- Versão do termo do questionário de exemplo (config/questionnaire.example.json). Uma versão só
-- é aceita se estiver aqui (ADR 0008 §2.1, #76); na instância real, a do arquivo instalado
-- entra por migration.
insert into app.questionnaire_term_versions (version) values ('termo-exemplo-1');
