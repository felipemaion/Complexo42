import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Estrutura e catálogo fixos da instância vão ao servidor por MIGRATION (o seed só roda no `supabase db
// reset`/`start`, e o `migra.sh` não aplica seed): tipos de unidade, a unidade raiz, as casas e o catálogo
// de habilidades. Tudo idempotente, para repetir sem duplicar nem desfazer o que o operador mudou.
const sql = readFileSync("supabase/migrations/20261128040000_estrutura_instancia.sql", "utf8");

/** Cada comando de inserção, até o `;` que o fecha (os textos do catálogo não têm `;`). */
const inserts = [...sql.matchAll(/insert into [\s\S]*?;/g)].map((m) => m[0]);

describe("migration da estrutura da instância", () => {
  it("cria tipos de unidade, raiz, casas e habilidades", () => {
    for (const tabela of ["public.unit_types", "public.units", "public.houses", "public.skills"]) {
      expect(inserts.some((i) => i.startsWith(`insert into ${tabela}`)), tabela).toBe(true);
    }
  });

  it("todo insert é idempotente (on conflict ou not exists)", () => {
    for (const insert of inserts) {
      expect(insert, insert.slice(0, 60)).toMatch(/on conflict[^;]*do nothing|\bnot exists\b/i);
    }
  });

  it("nunca reativa nem sobrescreve o que o operador já mudou", () => {
    expect(sql).not.toMatch(/do update/i);
    expect(sql).not.toMatch(/\bdelete\b|\btruncate\b/i);
  });

  it("não cria pessoa nem papel (isso é do bootstrap, #295)", () => {
    expect(sql).not.toMatch(/public\.(profiles|role_assignments|unit_members)/);
  });

  it("o catálogo de habilidades segue com as 47 do catálogo provisório", () => {
    const skills = inserts.find((i) => i.startsWith("insert into public.skills")) ?? "";
    expect([...skills.matchAll(/^\s*\('[^']+',\s*'[^']+',\s*array\[/gm)]).toHaveLength(47);
  });
});
