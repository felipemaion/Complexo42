// #76 / ADR 0008 §2.1: as respostas do questionário não saem do aparelho. Guarda estática do
// código que roda no navegador; o E2E (e2e/house-live.spec.ts) confere as requisições de verdade.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire, toPublicQuestionnaire } from "@/modules/questionnaire";

const CLIENT_DIR = "src/modules/houses/components";
// Escala e gráfico (#183) também rodam no navegador e recebem a resposta e as notas dos eixos da casa.
const CLIENT_DIRS = [CLIENT_DIR, "src/modules/questionnaire/components"];
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
  const files = CLIENT_DIRS.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => join(dir, f)));

  it("os componentes da escolha da casa, a escala e o gráfico não usam rede, armazenamento, URL nem log", () => {
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) expect([file, findForbidden(readFileSync(file, "utf8"))]).toEqual([file, []]);
  });

  it("as únicas chamadas ao servidor levam as respostas (para o servidor pontuar), a casa com a forma de entrada ou a versão do termo; nunca casa nem totem do resultado", () => {
    const flow = readFileSync(join(CLIENT_DIR, "house-flow.tsx"), "utf8");
    const calls = [...flow.matchAll(/\b(?!guardAction)(\w+Action)\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2]})`);
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
    for (const dir of CLIENT_DIRS) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
        const source = readFileSync(join(dir, file), "utf8");
        // Só o tipo `HouseByPoles` (import type) e o payload `byPoles` podem aparecer: o mapa polos → casa chega à tela só com o
        // resultado (#201, decisão do gestor), com o nome `byPoles`. A chave (itens, eixos, letras, desempates,
        // nomes dos totens) e a config completa nunca chegam aos componentes.
        expect(source, file).not.toMatch(
          /scoreQuestionnaire|QuestionnaireConfig|getQuestionnaire|houseByPoles|\baxes\b|itemIds|\bletters\b|totemLabels|tieBreak/,
        );
      }
    }
  });

  it("a página recebe só as perguntas e o termo: nem os eixos, nem os desempates, nem o mapa das casas (#201)", () => {
    const publicJson = JSON.stringify(toPublicQuestionnaire(parseQuestionnaire(example, instance.houses.map((house) => house.id))));
    expect(publicJson).not.toMatch(/axes|houseByPoles|tieBreakItems|totemLabels/);
  });
});
