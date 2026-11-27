// "Não consegue pular" (ADR 0017): toda página, rota, ação e layout autenticados conferem a casa na entrada, por URL direta
// ou por chamada da ação. Só usam a variante sem casa: a tela da casa, o layout (a casa é conferida por cada página) e as
// ações da escolha da casa; termo, meus dados e excluir conta usam `requireAccessUser*` (o titular, sem casa).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src/app");
const entries = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return entries(path);
    return /^(page\.tsx|route\.ts|layout\.tsx|.*actions\.ts)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
const rel = (path: string) => path.slice(root.length + 1);

/** Tira comentários e textos entre aspas/crases: só chamada de verdade conta (não `// requireUser()` nem "requireUser()"). */
export function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

/** A chamada real `await requireX(` (de um dos nomes dados) no código, fora de comentário e de texto. */
export function callsRequire(source: string, names: readonly string[]): boolean {
  return new RegExp(`\\bawait\\s+(?:${names.join("|")})\\(`).test(stripNonCode(source));
}

const withHouse = ["requireUser", "requireUserClient", "requireCoordinationScreen"];
const beforeHouse = ["requireUserBeforeHouse", "requireUserClientBeforeHouse"];
const holder = ["requireAccessUser", "requireAccessUserClient"];

describe("callsRequire (o próprio detector)", () => {
  it("só a chamada real conta: comentário, texto e o nome sem chamada não valem", () => {
    expect(callsRequire("const u = await requireUser();", withHouse)).toBe(true);
    expect(callsRequire("await requireUserClient();", withHouse)).toBe(true);
    expect(callsRequire("// await requireUser();", withHouse)).toBe(false);
    expect(callsRequire("/* await requireUser(); */", withHouse)).toBe(false);
    expect(callsRequire('const s = "await requireUser()";', withHouse)).toBe(false);
    expect(callsRequire("const s = `await requireUser()`;", withHouse)).toBe(false);
    expect(callsRequire("import { requireUser } from 'x'; const f = requireUser;", withHouse)).toBe(false);
    expect(callsRequire("requireUser();", withHouse)).toBe(false); // sem await, o redirect não é esperado
    expect(callsRequire("await requireUserBeforeHouse();", withHouse)).toBe(false);
  });
});

const files = entries(join(root, "(conta)"));

describe("casa antes de tudo: toda rota, ação e layout de (conta) confere a casa", () => {
  it("há arquivos a conferir (páginas, rotas, ações e o layout)", () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.map(rel)).toEqual(expect.arrayContaining(["(conta)/layout.tsx", "(conta)/perfil/actions.ts", "(conta)/perfil/localities-actions.ts"]));
  });

  it.each(files.map((path) => [rel(path), readFileSync(path, "utf8")] as const))("%s", (path, source) => {
    // A tela da casa e o layout só exigem a sessão e o termo; cada página confere a casa.
    const allowedWithoutHouse = path === "(conta)/casa/page.tsx" || path === "(conta)/layout.tsx";
    // O titular vê/baixa os próprios dados sem casa (ADR 0017 §2).
    const isHolder = path === "(conta)/meus-dados/route.ts";
    if (allowedWithoutHouse) expect(callsRequire(source, beforeHouse), "chama requireUser*BeforeHouse").toBe(true);
    else if (isHolder) expect(callsRequire(source, holder), "chama requireAccessUser*").toBe(true);
    else expect(callsRequire(source, withHouse), "chama requireUser, requireUserClient ou requireCoordinationScreen").toBe(true);
    if (!allowedWithoutHouse) expect(callsRequire(source, beforeHouse), "não usa a variante sem casa").toBe(false);
  });

  it("as ações da escolha da casa (módulo houses) usam a variante sem casa, e nada mais lá usa a com casa", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/houses/server/actions.ts"), "utf8");
    expect(callsRequire(source, beforeHouse)).toBe(true);
    expect(callsRequire(source, withHouse)).toBe(false);
  });
});
