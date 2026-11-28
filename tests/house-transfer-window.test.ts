// Janela de transferência de casa (#302, ADR 0016): a trava individual de 4 meses saiu por inteiro. Nada em
// `src/` nem em `config/` fala mais de `locked_until`, do erro C7603, do aviso com a data nem do
// aviso de 4 meses; o histórico das migrations antigas fica como está.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sources = [...files("src"), ...files("config")].filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("window.test.ts"));
const dead = /locked_until|lockedUntil|C7603|consentLockNotice|lockedUntilNotice|house_locked|houseLockNotice|canChangeHouse|formatLockDate|trocaLiberadaEm/;

describe("trava de 4 meses removida", () => {
  it("nenhum código nem texto da config cita a trava", () => {
    const hits = sources.filter((f) => dead.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("o módulo da trava não existe mais", () => {
    expect(existsSync("src/modules/houses/domain/house-lock.ts")).toBe(false);
  });
});

describe("janela de transferência", () => {
  it("a tela da pessoa só oferece 'Trocar de casa' com a janela aberta (lida no servidor)", () => {
    const page = readFileSync("src/app/(conta)/casa/page.tsx", "utf8");
    expect(page).toContain("readTransferWindow");
    expect(page).not.toMatch(/Date|now\(\)/);
  });

  it("a página inicial não mostra data de troca", () => {
    const home = readFileSync("src/app/(conta)/inicio/page.tsx", "utf8");
    expect(home).not.toMatch(/readHouseLock|lockedUntil/);
  });

  it("só a coordenação nacional vê o controle da janela (o banco decide; a tela é conforto)", () => {
    const menu = readFileSync("src/app/(conta)/coordenacao/page.tsx", "utf8");
    expect(menu).toContain("/coordenacao/casas/janela");
    expect(menu).toMatch(/questionnaire\.national[\s\S]*casas\/janela/);
  });
});
