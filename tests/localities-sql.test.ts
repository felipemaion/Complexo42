// Dados de referência de localidades (issue #175): o gerador a partir da API do IBGE recusa o que
// destoa, e as migrations geradas batem com o que o app espera (UFs, formato dos códigos).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { states } from "@config/states";
import {
  buildDistrictsSql,
  buildMunicipalitiesSql,
  districtsMigrationName,
  municipalitiesMigrationName,
  parseDistricts,
  parseMunicipalities,
} from "../scripts/generate-localities-sql.mjs";

const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

const ibgeMunicipality = (id: number, nome: string, sigla = "SP") => ({ id, nome, microrregiao: { mesorregiao: { UF: { sigla } } } });
const ibgeDistrict = (id: number, nome: string, municipioId: number) => ({ id, nome, municipio: { id: municipioId } });

describe("parseMunicipalities", () => {
  it("lê código, nome e UF, em ordem de código", () => {
    const rows = parseMunicipalities([ibgeMunicipality(3550308, "São Paulo"), ibgeMunicipality(3304557, "Rio de Janeiro", "RJ")]);
    expect(rows).toEqual([
      { code: 3304557, name: "Rio de Janeiro", stateCode: "RJ" },
      { code: 3550308, name: "São Paulo", stateCode: "SP" },
    ]);
  });

  it("recusa lista vazia, código repetido, UF ou nome fora do formato", () => {
    expect(() => parseMunicipalities([])).toThrow("localidades:");
    expect(() => parseMunicipalities([ibgeMunicipality(3550308, "Aa"), ibgeMunicipality(3550308, "Bb")])).toThrow("repetido");
    expect(() => parseMunicipalities([ibgeMunicipality(3550308, "São Paulo", "sp")])).toThrow("UF inválida");
    expect(() => parseMunicipalities([ibgeMunicipality(3550308, " São Paulo")])).toThrow("nome");
    expect(() => parseMunicipalities([ibgeMunicipality(355030, "São Paulo")])).toThrow("código");
  });
});

describe("parseDistricts", () => {
  it("lê o distrito e confere que o código começa pelo do município", () => {
    expect(parseDistricts([ibgeDistrict(355030801, "Água Rasa", 3550308)], [3550308])).toEqual([
      { code: 355030801, municipalityCode: 3550308, name: "Água Rasa" },
    ]);
    expect(() => parseDistricts([ibgeDistrict(355030801, "Água Rasa", 3550308)], [3304557])).toThrow("desconhecido");
    expect(() => parseDistricts([ibgeDistrict(330455701, "X Y", 3550308)], [3550308])).toThrow("não pertence");
  });
});

describe("SQL gerado", () => {
  it("escapa aspas e carrega a fonte e a data da consulta no cabeçalho", () => {
    const sql = buildMunicipalitiesSql({
      rows: [{ code: 1100015, name: "Alta Floresta D'Oeste", stateCode: "RO" }],
      queriedOn: "2026-11-27",
    });
    expect(sql).toContain("(1100015, 'Alta Floresta D''Oeste', 'RO')");
    expect(sql).toContain("https://servicodados.ibge.gov.br/api/v1/localidades/municipios");
    expect(sql).toContain("consultada em 2026-11-27");
    expect(sql).toContain("on conflict (code) do nothing");
  });

  it("distritos: diz quantos municípios têm só a sede", () => {
    const sql = buildDistrictsSql({
      rows: [
        { code: 110001505, municipalityCode: 1100015, name: "Alta Floresta D'Oeste" },
        { code: 355030801, municipalityCode: 3550308, name: "Água Rasa" },
        { code: 355030802, municipalityCode: 3550308, name: "Alto de Pinheiros" },
      ],
      queriedOn: "2026-11-27",
    });
    expect(sql).toContain("Em 1 municípios o único distrito é a sede.");
    expect(sql).toContain("(110001505, 1100015, 'Alta Floresta D''Oeste')");
  });
});

describe("migrations de localidades no repositório", () => {
  const municipalitiesSql = migration(municipalitiesMigrationName);
  const districtsSql = migration(districtsMigrationName);

  it("têm todos os municípios e distritos do IBGE (5571 e 10751 na consulta de 2026-11-27)", () => {
    expect(municipalitiesSql.match(/\(\d{7}, '/g)).toHaveLength(5571);
    expect(districtsSql.match(/\(\d{9}, \d{7}, '/g)).toHaveLength(10751);
  });

  it("o município e a capital paulista que o perfil usa estão lá, com os 96 distritos", () => {
    expect(municipalitiesSql).toContain("(3550308, 'São Paulo', 'SP')");
    expect(districtsSql.match(/\(3550308\d\d, 3550308, '/g)).toHaveLength(96);
  });

  it("toda UF dos municípios está na lista do formulário, e vice-versa", () => {
    const inData = new Set([...municipalitiesSql.matchAll(/, '([A-Z]{2})'\)/g)].map((match) => match[1]));
    expect([...inData].sort()).toEqual(states.map((state) => state.code).sort());
  });
});
