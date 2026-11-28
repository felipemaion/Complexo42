import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Toda extensão nasce no schema `extensions` (issue do staging): as funções do banco chamam
// `extensions.digest`, `extensions.hmac` e `extensions.ltree` com `search_path = ''`. Um
// `CREATE EXTENSION` sem schema cai em `public` e quebra o envio do questionário no servidor, e o banco
// local do CI, que já traz as extensões em `extensions`, não mostra o erro. Esta conferência olha o
// initdb do servidor (volume novo) e as migrations.
const dirs = ["deploy/initdb", "supabase/migrations"];

function sqlFiles(): string[] {
  return dirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => join(dir, f)));
}

/** Comandos `create extension ...;` do arquivo, sem os comentários (`-- ...`). */
function createExtensions(file: string): string[] {
  const sql = readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return [...sql.matchAll(/create\s+extension\b[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, " ").trim());
}

describe("create extension sempre com `with schema extensions`", () => {
  it("o initdb do servidor cria as extensões que as migrations usam (a conferência enxerga o arquivo)", () => {
    const found = createExtensions("deploy/initdb/01-extensions.sql");
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const name of ["ltree", "pgcrypto"]) expect(found.some((c) => new RegExp(`\\b${name}\\b`, "i").test(c)), name).toBe(true);
  });

  it("nenhum `create extension` do initdb nem das migrations deixa o schema por conta do search_path", () => {
    const sem: string[] = [];
    for (const file of sqlFiles()) {
      for (const command of createExtensions(file)) {
        if (!/with\s+schema\s+extensions\b/i.test(command)) sem.push(`${file}: ${command}`);
      }
    }
    expect(sem).toEqual([]);
  });
});
