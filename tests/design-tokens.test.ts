import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";

// Cores e fontes só pelos tokens de src/app/globals.css (#324): trocar a paleta ou a fonte é mexer num
// arquivo. Este teste barra, nos componentes (.tsx), a paleta crua do Tailwind (bg-red-700, text-white…),
// cor fixa (#1f4e79, bg-[#…], var(--color-…)) e fonte fixa (fontFamily, font-[…]).

const root = join(import.meta.dirname, "..");

const hardcodedStyle = new RegExp(
  [
    String.raw`\b(?:bg|text|border|ring|outline|fill|stroke|divide|accent|decoration|from|to|via|shadow|placeholder|caret)-(?:white|black|neutral|gray|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b`,
    String.raw`-\[#`,
    String.raw`var\(--color-`,
    String.raw`#[0-9a-fA-F]{6}\b`,
    String.raw`fontFamily`,
    String.raw`font-\[`,
  ].join("|"),
);

// Telas que os próximos PRs da #324 passam para os tokens, um grupo por PR: arquivo ou pasta (termina em /).
// Ao migrar, tire a linha daqui: o segundo teste falha se uma linha não casar mais com nada, para a lista só
// diminuir.
const pendingMigration = new Set([
  "src/app/(conta)/casa/page.tsx",
  "src/app/(conta)/coordenacao/casas/analise/[id]/page.tsx",
  "src/app/(conta)/coordenacao/casas/delegacoes/page.tsx",
  "src/app/(conta)/coordenacao/casas/janela/page.tsx",
  "src/app/(conta)/coordenacao/casas/resultados/[id]/page.tsx",
  "src/app/(conta)/coordenacao/casas/resultados/page.tsx",
  "src/app/(conta)/perfil/page.tsx",
  "src/app/(conta)/senha/",
  "src/modules/access/components/member-block-form.tsx",
  "src/modules/access/components/waitlist-queue.tsx",
  "src/modules/houses/components/compare-grid.tsx",
  "src/modules/houses/components/compare-houses.tsx",
  "src/modules/houses/components/house-flow.tsx",
  "src/modules/profiles/components/contact-visibility.tsx",
  "src/modules/profiles/components/profile-form.tsx",
  "src/modules/questionnaire/components/intensity-scale.tsx",
  "src/modules/questionnaire/components/spider-chart.tsx",
]);

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith(".tsx") ? [relative(root, path)] : [];
  });
}

const covers = (entry: string, file: string) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry);
const isPending = (file: string) => [...pendingMigration].some((entry) => covers(entry, file));

const filesWithHardcodedStyle = componentFiles(join(root, "src"))
  .filter((file) => hardcodedStyle.test(readFileSync(join(root, file), "utf8")))
  .sort();

/** Razão de contraste WCAG entre duas cores #rrggbb. */
function contrastRatio(a: string, b: string): number {
  const channel = (hex: string, at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

describe("tokens visuais (#324)", () => {
  it("a cor principal da instância contrasta com o texto branco dos botões e com o fundo claro (4,5:1)", () => {
    // --c-on-primary e --c-surface de src/app/globals.css: trocar a cor em config/ não pode quebrar o contraste.
    expect(contrastRatio(instance.colors.primary, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(instance.colors.primary, "#f4f6f9")).toBeGreaterThanOrEqual(4.5);
  });

  it("toda variável var(--color-…) usada no código existe em globals.css", () => {
    // O alias de um nome antigo some e a cor fica vazia sem erro nenhum (revisão do #328: polo B do questionário).
    const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
    const used = new Set(
      componentFiles(join(root, "src")).flatMap((file) => [...readFileSync(join(root, file), "utf8").matchAll(/var\((--color-[a-z-]+)\)/g)].map((m) => m[1])),
    );
    expect([...used].filter((name) => !css.includes(`${name}:`))).toEqual([]);
  });

  it("nenhum componente novo usa cor ou fonte fixa", () => {
    expect(filesWithHardcodedStyle.filter((file) => !isPending(file))).toEqual([]);
  });

  it("a lista de telas a migrar só diminui", () => {
    expect([...pendingMigration].filter((entry) => !filesWithHardcodedStyle.some((file) => covers(entry, file)))).toEqual([]);
  });

  it("o padrão pega cor e fonte fixas e deixa passar os tokens", () => {
    for (const bad of ["bg-red-700", "text-white", "border-neutral-400", "bg-[#1f4e79]", "bg-[var(--color-primary)]", "fontFamily: 'x'", "font-[Inter]"]) {
      expect(hardcodedStyle.test(bad), bad).toBe(true);
    }
    for (const ok of ["bg-primary", "text-on-primary", "border-field", "text-ink-muted", "bg-danger-soft", "border-current", "font-display"]) {
      expect(hardcodedStyle.test(ok), ok).toBe(false);
    }
  });
});
