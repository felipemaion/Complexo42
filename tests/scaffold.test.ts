// Garante os critérios da #3: TypeScript estrito e ESLint barrando HTML cru e `any`.
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

async function ruleIds(code: string, file = "src/app/exemplo.tsx"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: file });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "fatal");
}

describe("tsconfig", () => {
  const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8")) as {
    compilerOptions: Record<string, unknown>;
  };

  it("é estrito e proíbe any implícito", () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.noImplicitAny).toBe(true);
  });
});

describe("eslint", () => {
  it("recusa dangerouslySetInnerHTML", async () => {
    const code = `export function X({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
`;
    expect(await ruleIds(code)).toContain("react/no-danger");
  });

  it("recusa any explícito", async () => {
    const code = "export const f = (x: any): number => Number(x);\n";
    expect(await ruleIds(code, "src/exemplo.ts")).toContain("@typescript-eslint/no-explicit-any");
  });

  it("aceita um componente comum", async () => {
    const code = `export function Ok({ nome }: { nome: string }) {
  return <p>{nome}</p>;
}
`;
    expect(await ruleIds(code)).toEqual([]);
  });
}, 30_000);
