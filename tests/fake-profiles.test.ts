// Seed local de perfis fictícios (issue #8): pessoas determinísticas, só dados de teste, e o
// guarda de "só local" do script. O banco em si é conferido em supabase/tests/skills.test.sql.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFakePeople, fakePeopleCount } from "../scripts/fake-people.mjs";
import { readLocalStack } from "../scripts/seed-fake-profiles.mjs";
import { resolveTarget } from "../scripts/ts-resolve-hook.mjs";

const catalog = { municipalityCount: 39, skillCount: 47 };
const people = buildFakePeople(fakePeopleCount, catalog);

describe("buildFakePeople", () => {
  it("gera cerca de 50 pessoas", () => {
    expect(people).toHaveLength(50);
  });

  it("usa telefones do bloco +55119000000xx, todos diferentes", () => {
    expect(people.every((p) => /^\+55119000000\d{2}$/.test(p.whatsapp))).toBe(true);
    expect(new Set(people.map((p) => p.whatsapp)).size).toBe(people.length);
  });

  it("usa e-mail reservado para exemplo e nome que deixa claro ser teste", () => {
    expect(people.every((p) => p.email.endsWith("@example.com"))).toBe(true);
    expect(people.every((p) => /^\p{L}+ (Exemplo|Teste|Modelo|Demo|Fictício) \d{2}$/u.test(p.name))).toBe(true);
    expect(new Set(people.map((p) => p.email)).size).toBe(people.length);
  });

  it("é determinístico: duas chamadas dão as mesmas pessoas", () => {
    expect(buildFakePeople(fakePeopleCount, catalog)).toEqual(people);
  });

  it("escolhe de 2 a 6 habilidades distintas e municípios existentes", () => {
    for (const p of people) {
      expect(p.skillIndexes.length).toBeGreaterThanOrEqual(2);
      expect(p.skillIndexes.length).toBeLessThanOrEqual(6);
      expect(new Set(p.skillIndexes).size).toBe(p.skillIndexes.length);
      expect(p.skillIndexes.every((i) => i >= 0 && i < catalog.skillCount)).toBe(true);
      expect(p.municipalityIndex).toBeLessThan(catalog.municipalityCount);
    }
  });

  it("recusa quantidade fora do limite e catálogo pequeno demais", () => {
    expect(() => buildFakePeople(0, catalog)).toThrow(RangeError);
    expect(() => buildFakePeople(101, catalog)).toThrow(RangeError);
    expect(() => buildFakePeople(5, { municipalityCount: 39, skillCount: 3 })).toThrow(RangeError);
  });
});

describe("readLocalStack", () => {
  const output = (url: string) => `API_URL="${url}"\nSERVICE_ROLE_KEY="chave-de-teste"\n`;

  it("lê a URL e a chave do `supabase status -o env`", () => {
    expect(readLocalStack(output("http://127.0.0.1:54321"))).toEqual({
      url: "http://127.0.0.1:54321",
      serviceKey: "chave-de-teste",
    });
  });

  it("recusa endereço que não é local (nunca produção)", () => {
    expect(() => readLocalStack(output("https://projeto.exemplo.org"))).toThrow(/não é local/);
  });

  it.each(["http://127.0.0.1.evil.com:54321", "http://localhost.evil.com", "http://evil.com/127.0.0.1"])(
    "recusa host que só começa como o local: %s",
    (url) => {
      expect(() => readLocalStack(output(url))).toThrow(/não é local/);
    },
  );

  it("falha fechado quando o status não traz a chave", () => {
    expect(() => readLocalStack("API_URL=http://127.0.0.1:54321\n")).toThrow(/SERVICE_ROLE_KEY/);
  });
});

describe("resolveTarget (execução de src/ em script)", () => {
  const parent = new URL("../src/server/crypto/index.ts", import.meta.url).href;

  it("completa import relativo sem extensão com .ts", () => {
    expect(resolveTarget("./field", parent)).toMatch(/crypto\/field\.ts$/);
  });

  it("deixa o Node resolver pacote e import que já tem extensão", () => {
    expect(resolveTarget("zod", parent)).toBeNull();
    expect(resolveTarget("./field.ts", parent)).toBeNull();
  });

  it("troca server-only pela versão vazia do Next, que existe no disco", () => {
    const target = resolveTarget("server-only", parent);
    expect(target).toMatch(/server-only\/empty\.js$/);
    expect(existsSync(fileURLToPath(target as string))).toBe(true);
  });
});
