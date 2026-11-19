-- Municípios (issue #10; parte de referência da #8): tabela pública, só leitura pela API.
-- O perfil guarda o código IBGE do município, e a UF do perfil é derivada daqui (trigger na
-- migration `..._profiles.sql`). Município e UF ficam em texto puro: não identificam
-- ninguém (docs/MODELO_DADOS.md).
--
-- Dados: os 39 municípios da Região Metropolitana de São Paulo, com o código IBGE de 7
-- dígitos. Fonte (API pública de localidades do IBGE, consultada em 2026-11-19):
--   - https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/regioes-metropolitanas
--     (região metropolitana 04901, "Região Metropolitana de São Paulo": 39 municípios
--     distintos; São Paulo aparece em cada uma das 5 sub-regiões);
--   - conferido com https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios
--     (mesmo código e mesma grafia para os 39).
-- Ficam numa migration, e não no seed, porque são referência necessária em produção. Outras
-- regiões entram por nova migration, com a mesma conferência.

create table public.municipalities (
  code integer primary key check (code between 1000000 and 9999999),
  name text not null check (char_length(name) between 2 and 80),
  state_code char(2) not null check (state_code ~ '^[A-Z]{2}$'),
  -- Chave curta da região metropolitana (ex.: `rmsp`); nulo fora de região metropolitana.
  metro_region text check (metro_region ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Os dois primeiros dígitos do código IBGE são a UF; a sigla tem de bater com eles.
  constraint municipalities_state_matches_code check (
    (code / 100000, state_code::text) in (
      (11, 'RO'), (12, 'AC'), (13, 'AM'), (14, 'RR'), (15, 'PA'), (16, 'AP'), (17, 'TO'),
      (21, 'MA'), (22, 'PI'), (23, 'CE'), (24, 'RN'), (25, 'PB'), (26, 'PE'), (27, 'AL'),
      (28, 'SE'), (29, 'BA'), (31, 'MG'), (32, 'ES'), (33, 'RJ'), (35, 'SP'), (41, 'PR'),
      (42, 'SC'), (43, 'RS'), (50, 'MS'), (51, 'MT'), (52, 'GO'), (53, 'DF')
    )
  )
);

comment on table public.municipalities is
  'Municípios (código IBGE de 7 dígitos). Referência pública, só leitura pela API.';

create index municipalities_state_code_idx on public.municipalities (state_code);

alter table public.municipalities enable row level security;

revoke all on public.municipalities from anon, authenticated;
grant select on public.municipalities to authenticated;

-- Sem dado pessoal: qualquer pessoa logada lê. Escrita só por migration.
create policy municipalities_select on public.municipalities
  for select to authenticated
  using (true);

insert into public.municipalities (code, name, state_code, metro_region) values
  (3503901, 'Arujá', 'SP', 'rmsp'),
  (3505708, 'Barueri', 'SP', 'rmsp'),
  (3506607, 'Biritiba Mirim', 'SP', 'rmsp'),
  (3509007, 'Caieiras', 'SP', 'rmsp'),
  (3509205, 'Cajamar', 'SP', 'rmsp'),
  (3510609, 'Carapicuíba', 'SP', 'rmsp'),
  (3513009, 'Cotia', 'SP', 'rmsp'),
  (3513801, 'Diadema', 'SP', 'rmsp'),
  (3515004, 'Embu das Artes', 'SP', 'rmsp'),
  (3515103, 'Embu-Guaçu', 'SP', 'rmsp'),
  (3515707, 'Ferraz de Vasconcelos', 'SP', 'rmsp'),
  (3516309, 'Francisco Morato', 'SP', 'rmsp'),
  (3516408, 'Franco da Rocha', 'SP', 'rmsp'),
  (3518305, 'Guararema', 'SP', 'rmsp'),
  (3518800, 'Guarulhos', 'SP', 'rmsp'),
  (3522208, 'Itapecerica da Serra', 'SP', 'rmsp'),
  (3522505, 'Itapevi', 'SP', 'rmsp'),
  (3523107, 'Itaquaquecetuba', 'SP', 'rmsp'),
  (3525003, 'Jandira', 'SP', 'rmsp'),
  (3526209, 'Juquitiba', 'SP', 'rmsp'),
  (3528502, 'Mairiporã', 'SP', 'rmsp'),
  (3529401, 'Mauá', 'SP', 'rmsp'),
  (3530607, 'Mogi das Cruzes', 'SP', 'rmsp'),
  (3534401, 'Osasco', 'SP', 'rmsp'),
  (3539103, 'Pirapora do Bom Jesus', 'SP', 'rmsp'),
  (3539806, 'Poá', 'SP', 'rmsp'),
  (3543303, 'Ribeirão Pires', 'SP', 'rmsp'),
  (3544103, 'Rio Grande da Serra', 'SP', 'rmsp'),
  (3545001, 'Salesópolis', 'SP', 'rmsp'),
  (3546801, 'Santa Isabel', 'SP', 'rmsp'),
  (3547304, 'Santana de Parnaíba', 'SP', 'rmsp'),
  (3547809, 'Santo André', 'SP', 'rmsp'),
  (3548708, 'São Bernardo do Campo', 'SP', 'rmsp'),
  (3548807, 'São Caetano do Sul', 'SP', 'rmsp'),
  (3549953, 'São Lourenço da Serra', 'SP', 'rmsp'),
  (3550308, 'São Paulo', 'SP', 'rmsp'),
  (3552502, 'Suzano', 'SP', 'rmsp'),
  (3552809, 'Taboão da Serra', 'SP', 'rmsp'),
  (3556453, 'Vargem Grande Paulista', 'SP', 'rmsp');
