// Guarda (23/11): nenhum arquivo de código em src/ pode estar sendo ignorado pelo git. Nasceu de falha
// real: a regra "data/" do .gitignore (feita para a pasta de logs da raiz) escondia
// src/modules/map/data/rmsp-paths.json. Na máquina de quem programa tudo passava; no CI o mapa não
// compilava e quatro jobs caíram juntos (PR #167).
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Fora de um repositório git (ex.: código copiado sem a pasta .git) não há o que conferir.
function insideGitRepo(): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: "pipe" }).trim() === "true";
  } catch {
    return false;
  }
}

function ignoredInSource(): string[] {
  const out = execFileSync("git", ["status", "--porcelain", "--ignored", "--untracked-files=all", "src"], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((line) => line.startsWith("!! "))
    .map((line) => line.slice(3));
}

describe("código fonte inteiro no git", () => {
  it.skipIf(!insideGitRepo())("nada dentro de src/ é ignorado pelo .gitignore", () => {
    // Act
    const ignored = ignoredInSource();

    // Assert
    expect(ignored).toEqual([]);
  });
});
