// Garante os critérios da #60: actions fixadas por SHA, checkout sem credencial
// persistida e Dependabot atualizando as actions.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS_DIR = ".github/workflows";
const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, lines: readFileSync(join(WORKFLOWS_DIR, f), "utf8").split("\n") }));

// `uses:` de actions remotas (actions locais `./` e imagens `docker://` ficam de fora).
function usesLines(lines: string[]): { index: number; ref: string }[] {
  return lines.flatMap((line, index) => {
    const match = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/.exec(line);
    const ref = match?.[1];
    if (!ref || ref.startsWith("./") || ref.startsWith("docker://")) return [];
    return [{ index, ref }];
  });
}

describe("workflows do GitHub Actions", () => {
  it("existem e usam actions", () => {
    expect(workflows.length).toBeGreaterThan(0);
    expect(workflows.flatMap((w) => usesLines(w.lines)).length).toBeGreaterThan(0);
  });

  it("fixam toda action por SHA completo com a versão no comentário", () => {
    const bad = workflows.flatMap(({ file, lines }) =>
      usesLines(lines)
        .filter(({ ref }) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(ref))
        .map(({ ref }) => `${file}: ${ref}`),
    );
    expect(bad).toEqual([]);
  });

  it("rodam actions/checkout com persist-credentials: false", () => {
    const bad = workflows.flatMap(({ file, lines }) =>
      usesLines(lines)
        .filter(({ ref }) => ref.startsWith("actions/checkout@"))
        .filter(({ index }) => !/persist-credentials:\s*false/.test(lines[index + 1] ?? ""))
        .map(({ index }) => `${file}:${index + 1}`),
    );
    expect(bad).toEqual([]);
  });

  it("instalam a mesma versão do Supabase CLI da devDependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const ci = readFileSync(join(WORKFLOWS_DIR, "ci.yml"), "utf8");
    expect(ci).toMatch(new RegExp(`version: ${pkg.devDependencies.supabase?.replaceAll(".", "\\.")} `));
  });
});

describe("dependabot", () => {
  it("atualiza as actions do GitHub (SHA e comentário)", () => {
    const config = readFileSync(".github/dependabot.yml", "utf8");
    expect(config).toMatch(/package-ecosystem:\s*github-actions/);
  });
});
