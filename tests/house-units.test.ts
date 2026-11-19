// Ligação entre as casas de config/instance.ts e as casas do seed (ADR 0011, R17). A casa é
// nacional: o seed tem uma linha em `houses` por casa da config, com a chave igual ao `id`, e o
// banco não guarda o nome (fica só na config).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";

const seed = readFileSync("supabase/seed.sql", "utf8");

/** Lê as chaves de `insert into public.houses (key) values ('a'), ('b');` do seed. */
function seedHouseKeys(sql: string): string[] {
  const block = /insert into public\.houses \(key\) values([^;]+);/.exec(sql);
  if (!block) return [];
  return [...block[1]!.matchAll(/\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]!);
}

/** Mesmo formato do CHECK `houses_key_format` (supabase/migrations/..._national_houses.sql). */
const HOUSE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("casas da config ↔ casas do seed", () => {
  const keys = seedHouseKeys(seed);
  const ids = instance.houses.map((h) => h.id);

  it("lê as casas do seed (o padrão continua casando com o arquivo)", () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it("o seed tem exatamente as casas da config, sem repetir", () => {
    expect([...keys].sort()).toEqual([...ids].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("todo id de casa da config é uma chave válida no banco (a-z, 0-9 e hífen; até 63)", () => {
    for (const id of ids) {
      expect(id).toMatch(HOUSE_KEY);
      expect(id.length).toBeLessThanOrEqual(63);
    }
  });

  it("o seed não cria casa como unidade da árvore (o modelo da #76 saiu)", () => {
    expect(seed).not.toMatch(/seed_unit\(\s*'house'/);
    expect(seed).not.toMatch(/membership_axis/);
  });

  it("o seed não guarda o nome da casa (os textos ficam na config, R17)", () => {
    for (const house of instance.houses) expect(seed).not.toContain(house.name);
  });

  it("o seed registra a versão do termo do questionário de exemplo (só versões registradas são aceitas)", () => {
    const versions = [...seed.matchAll(/insert into app\.questionnaire_term_versions \(version\) values \('([^']+)'\)/g)].map((m) => m[1]);
    expect(versions).toContain(example.consentTermVersion);
  });
});
