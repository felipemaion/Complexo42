-- Seed da instância piloto (issue #46, ADR 0008 §2). Só dados fictícios e de estrutura:
-- nenhuma pessoa, nenhum papel. Roda no `supabase db reset` e no `supabase start`.
--
-- Árvore de território: nacional → estado → região (incubadora) → equipes. As casas são
-- nacionais, fora da árvore (ADR 0011).
-- Os rótulos exibidos vêm de `unit_types.label` (R17): o código nunca usa estes nomes.

insert into public.unit_types (key, label, level) values
  ('national', 'Nacional', 0),
  ('state', 'Estado', 1),
  ('region', 'Região', 2),
  ('team', 'Equipe', 3);

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

select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_1', 'Equipe 1');
select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_2', 'Equipe 2');
select pg_temp.seed_unit('team', 'br.sp.zona_leste', 'equipe_1', 'Equipe 1');
select pg_temp.seed_unit('team', 'br.mg.central', 'equipe_1', 'Equipe 1');

-- Casas nacionais (ADR 0011): a chave é o `id` da casa em config/instance.ts; o nome e os
-- textos ficam só na config (R17). tests/house-units.test.ts confere seed e config juntos.
-- Idempotente: em produção (onde o seed não roda) este mesmo comando é aplicado à mão
-- (docs/OPERACAO.md, "Casas").
insert into public.houses (key) values
  ('casa-exemplo-1'),
  ('casa-exemplo-2'),
  ('casa-exemplo-3'),
  ('casa-exemplo-4')
on conflict (key) do update set active = true;

-- Versão do termo do questionário de exemplo (config/questionnaire.example.json). Uma versão só
-- é aceita se estiver aqui (ADR 0008 §2.1, #76); na instância real, a do arquivo instalado
-- entra por migration.
insert into app.questionnaire_term_versions (version) values ('termo-exemplo-1');

-- Chave de assinatura do resultado do questionário (ADR 0014), SÓ DE DESENVOLVIMENTO: a mesma de
-- .env.example e do playwright.config.ts. Em produção o seed não roda: a chave é instalada por
-- quem opera (docs/OPERACAO.md).
insert into app.server_secrets (name, value)
values ('questionnaire_signing_key', 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=');
