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

  it("nenhuma cor fixa fora do tema (neutral, red, green, white, black) nem variante dark:", () => {
    const fixed = /\b(?:bg|text|border|ring)-(?:neutral|gray|red|green|white|black)(?:-\d{2,3})?\b|\bdark:/;

    const offenders = classStrings().filter(({ classes }) => fixed.test(classes));

    expect(offenders).toEqual([]);
  });

  it("nenhuma cor por estilo direto no elemento", () => {
    const offenders = tsxFiles("src").filter((file) => /style=\{\{\s*(?:backgroundColor|color)\s*:/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
