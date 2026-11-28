import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guarda contra doc de regra esvaziado por resolução de conflito ou rebase (aconteceu com
// docs/MODELO_DADOS.md, que ficou com 0 bytes na main). Cada doc precisa de um mínimo de linhas e dos títulos
// principais. Os mínimos ficam bem abaixo do tamanho atual: só pegam esvaziamento, não impedem enxugar texto.
const docs: { path: string; minLines: number; headings: RegExp[] }[] = [
  {
    path: "docs/MODELO_DADOS.md",
    minLines: 300,
    headings: [/^# Modelo de dados/m, /^## Dados pessoais permitidos/m, /^## Proibidos/m, /^## Entidades/m],
  },
  {
    path: "AGENTS.md",
    minLines: 100,
    headings: [/^# AGENTS\.md/m, /^## 1\. Regras inegociáveis/m, /^## 2\. Convenções/m],
  },
  {
    path: "docs/LGPD_E_SEGURANCA.md",
    minLines: 40,
    headings: [/^# LGPD e segurança/m, /^## 2\. LGPD/m, /^## 3\. Modelo de ameaças/m],
  },
  {
    path: "docs/OPERACAO.md",
    minLines: 500,
    headings: [/^# Operação do Supabase auto-hospedado/m, /^## Antes da primeira subida/m],
  },
];

describe("docs de regra não podem ficar vazios", () => {
  for (const doc of docs) {
    it(`${doc.path} tem o tamanho e os títulos principais`, () => {
      const text = readFileSync(doc.path, "utf8");
      expect(text.split("\n").length, `${doc.path} com poucas linhas`).toBeGreaterThanOrEqual(doc.minLines);
      for (const heading of doc.headings) expect(text, `${doc.path} sem ${heading}`).toMatch(heading);
    });
  }
});
