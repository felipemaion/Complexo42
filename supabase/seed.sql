-- Seed da instância piloto (issue #46, ADR 0008 §2). Só dados fictícios e de estrutura:
-- nenhuma pessoa, nenhum papel. Roda no `supabase db reset` e no `supabase start`.
--
-- Árvore: nacional → estado → região (incubadora) → casas e equipes.
-- Os rótulos exibidos vêm de `unit_types.label` (R17): o código nunca usa estes nomes.

insert into public.unit_types (key, label, level) values
  ('national', 'Nacional', 0),
  ('state', 'Estado', 1),
  ('region', 'Região', 2),
  ('house', 'Casa', 3),
  ('team', 'Equipe', 3);

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

select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_1', 'Casa 1');
select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_2', 'Casa 2');
select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_3', 'Casa 3');
select pg_temp.seed_unit('house', 'br.sp.abc', 'casa_4', 'Casa 4');
select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_1', 'Equipe 1');
select pg_temp.seed_unit('team', 'br.sp.abc', 'equipe_2', 'Equipe 2');

select pg_temp.seed_unit('house', 'br.sp.zona_leste', 'casa_1', 'Casa 1');
select pg_temp.seed_unit('team', 'br.sp.zona_leste', 'equipe_1', 'Equipe 1');

select pg_temp.seed_unit('house', 'br.mg.central', 'casa_1', 'Casa 1');
select pg_temp.seed_unit('team', 'br.mg.central', 'equipe_1', 'Equipe 1');
