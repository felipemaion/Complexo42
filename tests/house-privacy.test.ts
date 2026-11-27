// #76 / ADR 0008 §2.1: as respostas do questionário não saem do aparelho. Guarda estática do
// código que roda no navegador; o E2E (e2e/house-live.spec.ts) confere as requisições de verdade.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_DIR = "src/modules/houses/components";
const FORBIDDEN = [
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /document\.cookie/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /sendBeacon/,
  /\bWebSocket\b/,
  /history\.(push|replace)State/,
  /searchParams/,
  /console\./,
];

/** Ocorrências proibidas fora dos comentários. */
function findForbidden(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return FORBIDDEN.filter((re) => re.test(code)).map(String);
}

describe("respostas do questionário só no aparelho", () => {
  const files = readdirSync(CLIENT_DIR).filter((f) => f.endsWith(".tsx"));

  it("os componentes da escolha da casa não usam rede, armazenamento, URL nem log", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect([file, findForbidden(readFileSync(join(CLIENT_DIR, file), "utf8"))]).toEqual([file, []]);
  });

  it("as únicas chamadas ao servidor levam as respostas (para o servidor pontuar), a casa com a forma de entrada ou a versão do termo; nunca casa nem totem do resultado", () => {
    const flow = readFileSync(join(CLIENT_DIR, "house-flow.tsx"), "utf8");
    const calls = [...flow.matchAll(/await (\w+Action)\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2]})`);
    expect(calls).toEqual([
      "recordConsentAction({ termVersion: questionnaire.consentTermVersion })",
      "submitAnswersAction({ answers })",
      "acceptHouseAction({ houseId, joinMethod })",
    ]);
  });

  it("a guarda acusa um componente que grava as respostas (prova de que funciona)", () => {
    expect(findForbidden("localStorage.setItem('r', JSON.stringify(answers));")).not.toEqual([]);
    expect(findForbidden("// localStorage citado em comentário")).toEqual([]);
  });
});

describe("a chave do questionário não chega ao navegador (ADR 0014 §1)", () => {
  it("os componentes não importam a pontuação nem o config completo", () => {
    for (const file of readdirSync(CLIENT_DIR).filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(join(CLIENT_DIR, file), "utf8");
      expect(source, file).not.toMatch(/scoreQuestionnaire|QuestionnaireConfig|houseByPoles|tieBreakItems/);
    }
  });
});
