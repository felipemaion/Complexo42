// Critério da #54 / R17: nenhum nome da instância ('academia', 'turma', nomes das casas) fixo
// em `src/`. Os nomes vêm de config/instance.ts; a semente do banco fica em supabase/ (#46).
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { findInstanceTerms, instanceTerms, normalize, readTree } from "./lib/instance-terms";

/**
 * Exceções por arquivo (caminho relativo a `src/` → termos tolerados). Mantenha pequena e
 * justifique cada entrada. Hoje nenhuma é necessária.
 */
const ALLOWLIST: Record<string, readonly string[]> = {};

const terms = instanceTerms(instance);

describe("guarda de nomes da instância em src/", () => {
  it("inclui os termos fixos e os nomes vindos da configuração", () => {
    expect(terms).toEqual(expect.arrayContaining(["academia", "turma"]));
    for (const house of instance.houses) expect(terms).toContain(normalize(house.name));
    expect(terms).toContain("incubadora complexo42");
  });

  it("src/ não tem nenhum nome da instância", () => {
    const files = readTree("src");
    expect(files.length).toBeGreaterThan(0);
    expect(findInstanceTerms(files, terms, ALLOWLIST)).toEqual([]);
  });

  it("acusa um arquivo de amostra com nome fixo (prova de que a guarda funciona)", () => {
    const house = instance.houses[0]!;
    const sample = [
      { path: "app/x.tsx", content: `const a = 1;\nexport const t = "Bem-vindo à ACADEMIA";` },
      { path: "app/y.tsx", content: `<h2>Sua Turma</h2>\n<p>${house.name}</p>` },
    ];
    expect(findInstanceTerms(sample, terms)).toEqual([
      { file: "app/x.tsx", line: 2, term: "academia" },
      { file: "app/y.tsx", line: 1, term: "turma" },
      { file: "app/y.tsx", line: 2, term: house.name.toLowerCase() },
    ]);
  });

  it("ignora acentos e caixa, mas não acusa palavra que só contém o termo", () => {
    expect(findInstanceTerms([{ path: "a.ts", content: "TÚRMA" }], ["turma"])).toHaveLength(1);
    expect(findInstanceTerms([{ path: "a.ts", content: "turmalina, academias" }], ["turma", "academia"])).toEqual([]);
  });

  it("respeita a allowlist só no arquivo indicado", () => {
    const files = [
      { path: "liberado.ts", content: "turma" },
      { path: "outro.ts", content: "turma" },
    ];
    expect(findInstanceTerms(files, ["turma"], { "liberado.ts": ["turma"] })).toEqual([
      { file: "outro.ts", line: 1, term: "turma" },
    ]);
  });
});
