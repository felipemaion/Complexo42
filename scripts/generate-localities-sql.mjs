#!/usr/bin/env node
// `npm run db:gen-localities` (issue #175): gera as duas migrations de dados de referência
// (municípios e distritos do Brasil) a partir da API pública de localidades do IBGE. O SQL
// gerado é o que entra em `supabase/migrations/`; este script só existe para o resultado poder
// ser reproduzido e conferido (a consulta é de uma data, e o IBGE muda a lista de tempos em
// tempos). Rodar de novo gera o mesmo SQL para os mesmos dados, com a data de hoje no cabeçalho.
// Falha fechado: qualquer registro fora do formato esperado interrompe, sem escrever nada.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ibgeApiBase = "https://servicodados.ibge.gov.br/api/v1/localidades";
export const municipalitiesMigrationName = "20261127100000_municipalities_brazil.sql";
export const districtsMigrationName = "20261127100100_districts.sql";

const nameMaxChars = 80; // mesmo teto dos CHECKs de `municipalities.name` e `districts.name`
const sqlLineMaxChars = 100;
const fetchTimeoutMs = 60_000; // a API do IBGE sem resposta não pode travar o script

function fail(message) {
  throw new Error(`localidades: ${message}`);
}

function isCleanName(value) {
  return typeof value === "string" && value === value.trim() && value.length >= 2 && value.length <= nameMaxChars;
}

/** Município do IBGE → `{ code, name, stateCode }`, em ordem de código. Recusa o que destoa. */
export function parseMunicipalities(json) {
  if (!Array.isArray(json) || json.length === 0) fail("a lista de municípios veio vazia ou em outro formato");
  const rows = json.map((item) => {
    const stateCode = item?.microrregiao?.mesorregiao?.UF?.sigla ?? item?.["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla;
    if (!Number.isInteger(item?.id) || item.id < 1_000_000 || item.id > 9_999_999) fail(`código de município inválido: ${item?.id}`);
    if (!isCleanName(item.nome)) fail(`nome de município inválido (${item.id})`);
    if (!/^[A-Z]{2}$/.test(stateCode ?? "")) fail(`UF inválida no município ${item.id}`);
    return { code: item.id, name: item.nome, stateCode };
  });
  rows.sort((a, b) => a.code - b.code);
  if (new Set(rows.map((row) => row.code)).size !== rows.length) fail("código de município repetido");
  return rows;
}

/** Distrito do IBGE → `{ code, municipalityCode, name }`; o código tem de começar pelo do município. */
export function parseDistricts(json, municipalityCodes) {
  if (!Array.isArray(json) || json.length === 0) fail("a lista de distritos veio vazia ou em outro formato");
  const known = new Set(municipalityCodes);
  const rows = json.map((item) => {
    const municipalityCode = item?.municipio?.id;
    if (!Number.isInteger(item?.id) || item.id < 100_000_000 || item.id > 999_999_999) fail(`código de distrito inválido: ${item?.id}`);
    if (!known.has(municipalityCode)) fail(`distrito ${item.id} de município desconhecido`);
    if (Math.floor(item.id / 100) !== municipalityCode) fail(`distrito ${item.id} não pertence ao município ${municipalityCode}`);
    if (!isCleanName(item.nome)) fail(`nome de distrito inválido (${item.id})`);
    return { code: item.id, municipalityCode, name: item.nome };
  });
  rows.sort((a, b) => a.code - b.code);
  if (new Set(rows.map((row) => row.code)).size !== rows.length) fail("código de distrito repetido");
  return rows;
}

const sqlText = (value) => `'${value.replaceAll("'", "''")}'`;

/** Tuplas de `values`, várias por linha (dado gerado: poucas linhas, diff curto). */
function wrapTuples(tuples) {
  const lines = [];
  let line = "  ";
  for (const [index, tuple] of tuples.entries()) {
    const piece = index === tuples.length - 1 ? tuple : `${tuple},`;
    if (line.length > 2 && line.length + piece.length + 1 > sqlLineMaxChars) {
      lines.push(line.trimEnd());
      line = "  ";
    }
    line += line.length > 2 ? ` ${piece}` : piece;
  }
  lines.push(line);
  return lines.join("\n");
}

export function buildMunicipalitiesSql({ rows, queriedOn }) {
  const tuples = rows.map((row) => `(${row.code}, ${sqlText(row.name)}, '${row.stateCode}')`);
  return `-- Municípios do Brasil (issue #175; continua a #10): todos os municípios da API pública de
-- localidades do IBGE, com código de 7 dígitos, nome e UF. ${rows.length} registros.
-- GERADO por scripts/generate-localities-sql.mjs: dado de referência, não se edita à mão.
--
-- Fonte (consultada em ${queriedOn}):
--   ${ibgeApiBase}/municipios
-- Os ${rows.length} registros incluem Fernando de Noronha (2605459), que o IBGE lista à parte.
-- Os 39 municípios da Região Metropolitana de São Paulo já existem (migration
-- \`..._municipalities.sql\`) e ficam como estão, com \`metro_region = 'rmsp'\` (\`on conflict do
-- nothing\`). Os demais ficam sem região metropolitana: a API de regiões metropolitanas lista 39
-- municípios em mais de uma região e a coluna guarda uma chave só; fica para quando houver uso.

insert into public.municipalities (code, name, state_code) values
${wrapTuples(tuples)}
on conflict (code) do nothing;
`;
}

export function buildDistrictsSql({ rows, queriedOn }) {
  const perMunicipality = new Map();
  for (const row of rows) perMunicipality.set(row.municipalityCode, (perMunicipality.get(row.municipalityCode) ?? 0) + 1);
  const onlySeatCount = [...perMunicipality.values()].filter((count) => count === 1).length;
  const tuples = rows.map((row) => `(${row.code}, ${row.municipalityCode}, ${sqlText(row.name)})`);
  return `-- Distritos do Brasil (issue #175): tabela de referência pública, só leitura pela API. O perfil
-- guarda o código do distrito (migration \`..._profile_district_code.sql\`). ${rows.length} registros.
-- GERADO por scripts/generate-localities-sql.mjs: dado de referência, não se edita à mão.
--
-- Fonte (consultada em ${queriedOn}):
--   ${ibgeApiBase}/distritos
-- Código IBGE de 9 dígitos: os 7 primeiros são o município. Nome como o IBGE grafa (inclusive
-- sem acento em alguns, como "Cangaiba"). Em ${onlySeatCount} municípios o único distrito é a sede.

create table public.districts (
  code integer primary key check (code between 100000000 and 999999999),
  municipality_code integer not null references public.municipalities (code),
  name text not null check (char_length(name) between 2 and 80),
  -- Os dois últimos dígitos são o distrito; os sete primeiros são o município.
  constraint districts_code_starts_with_municipality check (code / 100 = municipality_code),
  -- Alvo da chave estrangeira composta do perfil: o distrito tem de ser do município do perfil.
  -- Também serve de índice para listar os distritos de um município.
  constraint districts_municipality_code_code_key unique (municipality_code, code)
);

comment on table public.districts is
  'Distritos (código IBGE de 9 dígitos). Referência pública, só leitura pela API.';

alter table public.districts enable row level security;

revoke all on public.districts from anon, authenticated;
grant select on public.districts to authenticated;

-- Sem dado pessoal; mesma regra dos municípios: lê quem está logado e não está na espera nem
-- bloqueado. Escrita só por migration.
create policy districts_select on public.districts
  for select to authenticated
  using (app.can_read_municipalities());

insert into public.districts (code, municipality_code, name) values
${wrapTuples(tuples)};
`;
}

async function fetchJson(path) {
  const response = await fetch(`${ibgeApiBase}/${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(fetchTimeoutMs) });
  if (!response.ok) fail(`a API do IBGE respondeu ${response.status} em /${path}`);
  return response.json();
}

export async function main({ outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations"), today = new Date() } = {}) {
  const queriedOn = today.toISOString().slice(0, 10);
  const municipalities = parseMunicipalities(await fetchJson("municipios"));
  const districts = parseDistricts(
    await fetchJson("distritos"),
    municipalities.map((row) => row.code),
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, municipalitiesMigrationName), buildMunicipalitiesSql({ rows: municipalities, queriedOn }));
  writeFileSync(resolve(outDir, districtsMigrationName), buildDistrictsSql({ rows: districts, queriedOn }));
  console.log(`localidades: ${municipalities.length} municípios e ${districts.length} distritos (consulta de ${queriedOn}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
