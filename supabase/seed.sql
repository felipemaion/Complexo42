-- Seed da instância piloto (issue #46, ADR 0008 §2). Só dados fictícios do ambiente LOCAL:
-- nenhuma pessoa, nenhum papel. Roda no `supabase db reset` e no `supabase start`.
--
-- A estrutura e o catálogo fixos (tipos de unidade, raiz nacional, casas, habilidades) vêm da
-- migration `..._estrutura_instancia.sql`, que também vai ao servidor. Aqui fica só a árvore de
-- exemplo abaixo da raiz: estado → região (incubadora) → equipes (ADR 0011: as casas são
-- nacionais, fora da árvore). Os rótulos exibidos vêm de `unit_types.label` (R17).

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

-- Os estados (sp, mg e os demais) já vêm da migration `20261128230000_estados_da_instancia.sql` (#365): as
-- regiões abaixo se penduram neles.

select pg_temp.seed_unit('region', 'br.sp', 'abc', 'Incubadora ABC');
select pg_temp.seed_unit('region', 'br.sp', 'zona_leste', 'Incubadora Zona Leste');
select pg_temp.seed_unit('region', 'br.mg', 'central', 'Incubadora Central');

select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_1', 'Equipe 1');
select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_2', 'Equipe 2');
select pg_temp.seed_unit('team', 'br.sp.zona_leste', 'equipe_1', 'Equipe 1');
select pg_temp.seed_unit('team', 'br.mg.central', 'equipe_1', 'Equipe 1');

-- Versão do termo do questionário de exemplo (config/questionnaire.example.json). Uma versão só
-- é aceita se estiver aqui (ADR 0008 §2.1, #76); na instância real, a do arquivo instalado
-- entra por migration.
insert into app.questionnaire_term_versions (version) values ('termo-exemplo-1');

-- Chave de assinatura do resultado do questionário (ADR 0014), SÓ DE DESENVOLVIMENTO: a mesma de
-- .env.example e do playwright.config.ts. Em produção o seed não roda: a chave é instalada por
-- quem opera (docs/OPERACAO.md).
insert into app.server_secrets (name, value)
values ('questionnaire_signing_key', 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=');
