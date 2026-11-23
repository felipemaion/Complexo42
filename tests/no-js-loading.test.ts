// Guarda (22/11): nenhuma tela de carregamento (loading.tsx) no app. Com ela, o Next manda primeiro o
// esqueleto e troca pelo conteúdo com um script; sem JavaScript, a troca nunca acontece e a pessoa fica
// presa no esqueleto. O app precisa funcionar sem JavaScript (e2e/member-block-live.spec.ts: a
// coordenação bloqueia "sem JavaScript"). Nasceu de falha real: o esqueleto de (conta) travou o bloqueio.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function loadingFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return loadingFiles(full);
    return /^loading\.(tsx|ts|jsx|js)$/.test(entry.name) ? [full] : [];
  });
}

describe("app sem JavaScript", () => {
  it("não tem loading.tsx (o esqueleto prenderia quem navega sem JavaScript)", () => {
    // Act
    const found = loadingFiles(join(process.cwd(), "src", "app"));

    // Assert
    expect(found).toEqual([]);
  });
});
