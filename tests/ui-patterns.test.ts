import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Telas novas no padrão do app (#324): toda página usa o PageShell e os componentes de src/modules/ui, não
// um <main> próprio nem as classes do visual antigo. Complementa tests/design-tokens.test.ts (cor e fonte).

const root = join(import.meta.dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [relative(root, path)] : [];
  });
}

const read = (file: string) => readFileSync(join(root, file), "utf8");

/** O <main> de cada página é o PageShell (largura por tipo de página, espaçamento padrão). */
const ownMain = /<main[\s>]/;
/** Raio e borda do visual antigo: os tokens são rounded-control e rounded-card, e as bordas border-line e border-field. */
const legacyClass = /\b(?:rounded-xl|rounded-lg|border-current)\b/;

describe("padrão visual das telas (#324)", () => {
  it("nenhuma página monta o próprio <main>: usa o PageShell de src/modules/ui", () => {
    const pages = tsxFiles(join(root, "src/app")).filter((file) => file.endsWith("page.tsx"));
    expect(pages.filter((file) => ownMain.test(read(file)))).toEqual([]);
  });

  it("fora de src/modules/ui não há rounded-xl, rounded-lg nem border-current", () => {
    const outsideUi = tsxFiles(join(root, "src")).filter((file) => !file.startsWith("src/modules/ui/"));
    expect(outsideUi.filter((file) => legacyClass.test(read(file)))).toEqual([]);
  });

  it("os padrões pegam o visual antigo e deixam passar os tokens", () => {
    for (const bad of ["<main className", "<main>", "rounded-xl", "rounded-lg p-4", "border-2 border-current"]) {
      expect(ownMain.test(bad) || legacyClass.test(bad), bad).toBe(true);
    }
    for (const ok of ["<PageShell width", "rounded-control", "rounded-card", "rounded-full", "border-field", "border-line", "<mainContent"]) {
      expect(ownMain.test(ok) || legacyClass.test(ok), ok).toBe(false);
    }
  });
});
