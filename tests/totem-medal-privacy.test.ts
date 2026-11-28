// REGRA DURA: o totem nunca aparece para a pessoa (ADR 0014 §2). As medalhas (/totens/) só entram nas telas da
// coordenação; o E2E (e2e/house-live.spec.ts) confere as páginas da pessoa renderizadas.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import example from "@config/questionnaire.example.json";
import { config as proxyConfig } from "@/proxy";
import { decideRoute } from "@/server/auth/routes";

const read = (path: string) => readFileSync(path, "utf8");
const tsxIn = (dir: string) => readdirSync(dir).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file)).map((file) => join(dir, file));

// O que a pessoa vê: início, casa, escolher/trocar de casa, resultado dela, comparação de casas e o escudo comum.
const PERSON_FILES = [
  ...tsxIn("src/app/(conta)/casa"),
  ...tsxIn("src/app/(conta)/inicio"),
  "src/modules/houses/components/house-flow.tsx",
  "src/modules/houses/components/own-house-card.tsx",
  "src/modules/houses/components/compare-houses.tsx",
  "src/modules/houses/components/house-shield.tsx",
  "src/modules/houses/domain/home-card.ts",
];
const MEDAL_SOURCES = [/\/totens\//, /totem-medal/i, /TotemMedal/, /totemMedalAssets/];
const totemNames = Object.values(example.totemLabels).map((label) => label.name);

describe("a pessoa nunca vê o totem nem a medalha", () => {
  it("as telas da pessoa existem na lista (a guarda não está vazia)", () => {
    expect(PERSON_FILES.length).toBeGreaterThan(6);
  });

  it("nenhuma tela da pessoa referencia /totens/, o módulo da medalha ou o nome de um totem", () => {
    for (const file of PERSON_FILES) {
      const source = read(file);
      for (const pattern of MEDAL_SOURCES) expect([file, pattern.test(source)]).toEqual([file, false]);
      for (const name of totemNames) expect([file, source.includes(name)]).toEqual([file, false]);
    }
  });

  it("as telas da coordenação usam a medalha (prova de que a guarda enxerga o que deve)", () => {
    expect(read("src/app/(conta)/coordenacao/casas/resultados/page.tsx")).toMatch(/TotemMedal|HouseWithTotem/);
    expect(read("src/app/(conta)/coordenacao/casas/resultados/[id]/page.tsx")).toMatch(/TotemMedal|HouseWithTotem/);
  });
});

describe("as medalhas só carregam para quem está logado", () => {
  it("o proxy NÃO exclui /totens/ (diferente de /casas/): sem sessão, vai para /entrar", () => {
    const matcher = proxyConfig.matcher.join("|");
    expect(matcher).not.toContain("totens");
    expect(decideRoute("/totens/pr-128.webp", "", false)).toMatchObject({ action: "redirect" });
    expect(decideRoute("/totens/pr-128.webp", "", true)).toEqual({ action: "next" });
  });
});
