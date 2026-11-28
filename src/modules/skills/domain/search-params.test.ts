import { describe, expect, it } from "vitest";
import { parseSearchParams, searchQueryString } from "./search-params";

const A = "8f1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e6f";
const B = "9a1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e70";

describe("parseSearchParams (filtros da busca na URL; #23)", () => {
  it("sem nada, é uma busca vazia (a tela mostra só o formulário)", () => {
    expect(parseSearchParams({})).toEqual({ skillIds: [], mode: "all" });
  });

  it("habilidades (uma ou várias), modo, UF, município, equipe, sem equipe e cursor", () => {
    expect(
      parseSearchParams({ h: [A, B], modo: "qualquer", uf: "sp", mun: "3550308", equipe: A, sem: "1", c: "2", i: B }),
    ).toEqual({ skillIds: [A, B], mode: "any", state: "SP", municipality: 3550308, unit: A, noTeam: true, after: { common: 2, id: B } });
    expect(parseSearchParams({ h: A }).skillIds).toEqual([A]);
  });

  it("descarta o que não vale, sem quebrar a tela: id ruim, repetido, UF e modo estranhos", () => {
    const parsed = parseSearchParams({ h: [A, A, "x", "<script>"], modo: "talvez", uf: "SPP", mun: "abc", equipe: "nao", c: "-1", i: "x" });
    expect(parsed).toEqual({ skillIds: [A], mode: "all" });
  });

  it("no máximo 5 habilidades", () => {
    const ids = Array.from({ length: 8 }, (_, n) => `00000000-0000-4000-8000-00000000000${n}`);
    expect(parseSearchParams({ h: ids }).skillIds).toHaveLength(5);
  });

  it("o cursor só vale completo (em comum e id)", () => {
    expect(parseSearchParams({ h: A, c: "2" }).after).toBeUndefined();
    expect(parseSearchParams({ h: A, i: B }).after).toBeUndefined();
  });
});

describe("searchQueryString (os filtros voltam para a URL, para salvar ou compartilhar)", () => {
  it("é o inverso do parse e põe o cursor da próxima página", () => {
    const filters = { skillIds: [A, B], mode: "any" as const, state: "SP", municipality: 3550308, unit: A, noTeam: true };
    const query = searchQueryString(filters, { common: 2, id: B });
    const params = new URLSearchParams(query);
    const raw: Record<string, string | string[]> = { h: params.getAll("h") };
    for (const key of ["modo", "uf", "mun", "equipe", "sem", "c", "i"]) {
      const value = params.get(key);
      if (value !== null) raw[key] = value;
    }
    expect(parseSearchParams(raw)).toMatchObject({ ...filters, after: { common: 2, id: B } });
    expect(query).toContain("h=" + A);
  });

  it("modo padrão e filtros vazios não poluem a URL", () => {
    expect(searchQueryString({ skillIds: [A], mode: "all" })).toBe(`h=${A}`);
  });
});
