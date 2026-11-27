import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regra de manutenção (AGENTS.md, DoD): PR que muda o schema atualiza o diagrama. Este teste confere
// que toda tabela criada nas migrations (schemas public e app, menos as removidas depois) aparece na
// seção "Modelo de dados" de docs/DIAGRAMAS.md, e que o diagrama não cita tabela que não existe.

const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"));

function tables(): string[] {
  const live = new Set<string>();
  for (const sql of migrations) {
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public|app)\.([a-z_]+)/g)) live.add(m[1]!);
    for (const m of sql.matchAll(/drop table (?:if exists )?(?:public|app)\.([a-z_]+)/g)) live.delete(m[1]!);
  }
  return [...live].sort();
}

function diagramSection(): string {
  const doc = readFileSync("docs/DIAGRAMAS.md", "utf8");
  const start = doc.search(/^## .*Modelo de dados/m);
  if (start < 0) return "";
  const rest = doc.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("diagrama do modelo de dados (docs/DIAGRAMAS.md)", () => {
  it("existe a seção \"Modelo de dados\" com diagramas Mermaid", () => {
    const section = diagramSection();
    expect(section).toContain("```mermaid");
    expect(section).toMatch(/erDiagram|classDiagram/);
  });

  it("toda tabela das migrations aparece no diagrama", () => {
    const section = diagramSection();
    const missing = tables().filter((table) => !new RegExp(`\\b${table}\\b`).test(section));
    expect(missing, `tabelas fora do diagrama: ${missing.join(", ")}`).toEqual([]);
  });

  it("o diagrama não declara entidade que não existe nas migrations", () => {
    const known = new Set(tables());
    const declared = [...diagramSection().matchAll(/^\s{4}([a-z_]+) \{$/gm)].map((m) => m[1]!);
    expect(declared.filter((name) => !known.has(name))).toEqual([]);
  });
});
