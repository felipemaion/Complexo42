// #17 (revisão do #100): além de `react/no-danger` (tests/scaffold.test.ts), o ESLint barra HTML
// cru no DOM: innerHTML, outerHTML, insertAdjacentHTML, document.write/writeln e srcDoc.
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const eslint = new ESLint();
// A primeira análise carrega a configuração e o analisador de TypeScript (vários segundos com o
// servidor ocupado): ela acontece aqui, com prazo próprio, e cada teste mede só a regra.
// Nasceu de falha real em 22/11: o primeiro caso estourava os 5 s sob carga.
const WARM_UP_TIMEOUT_MS = 60_000;
beforeAll(async () => {
  await eslint.lintText("export {};", { filePath: "src/exemplo.ts" });
}, WARM_UP_TIMEOUT_MS);

async function ruleIds(code: string, file = "src/app/exemplo.tsx"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: file });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "fatal");
}

const blocked = ["no-restricted-properties", "no-restricted-syntax"];
const isBlocked = (ids: string[]) => ids.some((id) => blocked.includes(id));

describe("eslint: HTML cru no DOM", () => {
  it.each([
    ["innerHTML (escrita)", "export function f(el: HTMLElement, s: string) { el.innerHTML = s; }"],
    ["innerHTML (leitura)", "export const f = (el: HTMLElement) => el.innerHTML;"],
    ["innerHTML com colchetes", 'export function f(el: HTMLElement, s: string) { el["innerHTML"] = s; }'],
    ["outerHTML", "export function f(el: HTMLElement, s: string) { el.outerHTML = s; }"],
    ["insertAdjacentHTML", 'export function f(el: HTMLElement, s: string) { el.insertAdjacentHTML("beforeend", s); }'],
    ["document.write", "export function f(s: string) { document.write(s); }"],
    ["document.writeln", "export function f(s: string) { document.writeln(s); }"],
    ["window.document.write", "export function f(s: string) { window.document.write(s); }"],
    ["innerHTML desestruturado", "export function f(el: HTMLElement) { const { innerHTML } = el; return innerHTML; }"],
  ])("recusa %s", async (_name, code) => {
    expect(isBlocked(await ruleIds(code, "src/exemplo.ts"))).toBe(true);
  });

  it("recusa srcDoc em iframe", async () => {
    const code = `export function X({ html }: { html: string }) {
  return <iframe title="x" srcDoc={html} />;
}
`;
    expect(isBlocked(await ruleIds(code))).toBe(true);
  });

  it("aceita texto e escrita comum (textContent, stream.write)", async () => {
    const code = `export function f(el: HTMLElement, s: string, out: { write: (t: string) => void }) {
  el.textContent = s;
  out.write(s);
}
`;
    expect(await ruleIds(code, "src/exemplo.ts")).toEqual([]);
  });
});
