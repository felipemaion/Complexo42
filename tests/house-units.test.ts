// Ligação entre as casas de config/instance.ts e as unidades de casa do seed (#76, ADR 0008 §2).
// O `slug` da unidade é o `id` da casa com `_` no lugar de `-`; o banco faz a mesma troca em
// `app.house_unit_for` (supabase/migrations/20261119170100_house_selection.sql).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";

/** Região piloto do seed: tem uma unidade para cada casa da config. */
const PILOT_REGION = "br.sp.abc";

type SeedHouse = { parent: string; slug: string };

/** Lê as chamadas `pg_temp.seed_unit('house', '<pai>', '<slug>', ...)` do seed. */
function seedHouses(sql: string): SeedHouse[] {
  const pattern = /seed_unit\(\s*'house'\s*,\s*'([a-z0-9_.]+)'\s*,\s*'([a-z0-9_]+)'/g;
  return [...sql.matchAll(pattern)].map((m) => ({ parent: m[1]!, slug: m[2]! }));
}

const toSlug = (id: string) => id.replaceAll("-", "_");

describe("casas da config ↔ unidades de casa do seed", () => {
  const houses = seedHouses(readFileSync("supabase/seed.sql", "utf8"));
  const configSlugs = instance.houses.map((h) => toSlug(h.id));

  it("lê as casas do seed (o padrão continua casando com o arquivo)", () => {
    expect(houses.length).toBeGreaterThan(0);
  });

  it("toda unidade de casa do seed corresponde a uma casa da config", () => {
    expect(houses.filter((h) => !configSlugs.includes(h.slug))).toEqual([]);
  });

  it("a região piloto tem uma unidade para cada casa da config, sem repetir", () => {
    const pilot = houses.filter((h) => h.parent === PILOT_REGION).map((h) => h.slug);
    expect([...pilot].sort()).toEqual([...configSlugs].sort());
  });

  it("todo id de casa vira um slug válido de unidade (a-z, 0-9, _; até 63)", () => {
    for (const slug of configSlugs) expect(slug).toMatch(/^[a-z0-9_]{1,63}$/);
  });

  it("o seed registra a versão do termo do questionário de exemplo (só versões registradas são aceitas)", () => {
    const sql = readFileSync("supabase/seed.sql", "utf8");
    const versions = [...sql.matchAll(/insert into app\.questionnaire_term_versions \(version\) values \('([^']+)'\)/g)].map((m) => m[1]);
    expect(versions).toContain(example.consentTermVersion);
  });
});
