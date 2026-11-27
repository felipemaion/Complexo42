// "Não consegue pular" (ADR 0017): toda página e rota autenticada confere a casa na entrada, por URL direta.
// Só usam a variante sem casa: a tela da casa e o que o titular sempre pode (termo, meus dados, excluir conta).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src/app");
const entries = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? entries(path) : /^(page\.tsx|route\.ts)$/.test(name) ? [path] : [];
  });
const rel = (path: string) => path.slice(root.length + 1);

// Páginas fora de (conta) são públicas ou do titular (sessão própria: termo).
const gated = entries(join(root, "(conta)"));

describe("casa antes de tudo: toda rota de (conta) confere a casa", () => {
  it("há rotas em (conta) para conferir", () => {
    expect(gated.length).toBeGreaterThan(10);
  });

  it.each(gated.map((path) => [rel(path), readFileSync(path, "utf8")] as const))("%s", (path, source) => {
    const beforeHouse = path === "(conta)/casa/page.tsx";
    const holder = path === "(conta)/meus-dados/route.ts"; // titular: ver/baixar os próprios dados sem casa (ADR 0017 §2)
    if (beforeHouse) expect(source).toMatch(/requireUserBeforeHouse\(/);
    else if (holder) expect(source).toMatch(/requireAccessUserClient\(/);
    else expect(source).toMatch(/require(User|UserClient|CoordinationScreen)\(/);
    // Ninguém fora da tela da casa usa a variante sem casa.
    if (!beforeHouse) expect(source).not.toMatch(/requireUserBeforeHouse|requireUserClientBeforeHouse/);
  });
});
