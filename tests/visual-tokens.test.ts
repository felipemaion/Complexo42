// Guarda do visual (direção A, src/app/globals.css): cor só por token do tema. Nasceu de um
// defeito real: um botão perdeu o fundo e ficou com texto branco sobre fundo branco (invisível).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Cada string de classes (entre aspas ou crases) de cada tela, com o arquivo de origem. */
function classStrings(): { file: string; classes: string }[] {
  return tsxFiles("src").flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/(["`])([^"`\n]*?)\1/g)].map((m) => ({ file, classes: m[2] ?? "" })),
  );
}

describe("tokens do visual", () => {
  it("texto na cor de cima do primário sempre vem com o fundo primário (nada de botão invisível)", () => {
    // Arrange
    const offenders = classStrings().filter(
      ({ classes }) => /\btext-on-primary\b/.test(classes) && !/\bbg-primary\b/.test(classes),
    );

    // Assert
    expect(offenders).toEqual([]);
  });

  it("texto sobre o secundário (amarelo) sempre na cor própria dele (nada de letra clara no amarelo)", () => {
    // Arrange: no tema escuro, text-ink é claro; sobre o amarelo ficaria ilegível.
    const textColor = /\btext-(?:ink|ink-muted|primary|surface|canvas|on-primary)\b/;

    // Act
    const offenders = classStrings().filter(({ classes }) => /\bbg-secondary\b/.test(classes) && textColor.test(classes));

    // Assert
    expect(offenders).toEqual([]);
  });

  it("nenhuma cor fixa fora do tema (neutral, red, green, white, black) nem variante dark:", () => {
    const fixed = /\b(?:bg|text|border|ring)-(?:neutral|gray|red|green|white|black)(?:-\d{2,3})?\b|\bdark:/;

    const offenders = classStrings().filter(({ classes }) => fixed.test(classes));

    expect(offenders).toEqual([]);
  });

  it("nenhuma letra abaixo do tamanho de base (text-xs, text-sm): público mais velho (ata 17/11 §10)", () => {
    // Arrange: base de 18 px; text-sm daria 15,75 px e text-xs 13,5 px.
    const small = /\btext-(?:xs|sm)\b|\btext-\[\d+px\]/;

    // Act
    const offenders = classStrings().filter(({ classes }) => small.test(classes));

    // Assert
    expect(offenders).toEqual([]);
  });

  it("nenhuma cor por estilo direto no elemento", () => {
    const offenders = tsxFiles("src").filter((file) => /style=\{\{\s*(?:backgroundColor|color)\s*:/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
