// Guarda da R17 (ADR 0005 §4): nenhum nome da instância fixo em `src/`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Termos de instância conhecidos que nunca entram no código genérico, qualquer instância. */
export const STATIC_INSTANCE_TERMS = ["academia", "turma", "turmas"] as const;

type ConfigNames = { name: string; shortName: string; houses: ReadonlyArray<{ id: string; name: string }> };

/** Junta os termos fixos com os nomes vindos da própria configuração (nome, casas). */
export function instanceTerms(config: ConfigNames): string[] {
  const fromConfig = [config.name, config.shortName, ...config.houses.flatMap((h) => [h.name, h.id])];
  return [...new Set([...STATIC_INSTANCE_TERMS, ...fromConfig].map(normalize))];
}

/** Minúsculas e sem acento, para "Turma" e "TURMA" casarem com "turma". */
export function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Finding = { file: string; line: number; term: string };

/**
 * Procura os termos como palavra inteira (não acusa "turmalina"). `allow` mapeia caminho →
 * termos tolerados naquele arquivo; qualquer exceção precisa de justificativa no comentário.
 */
export function findInstanceTerms(
  files: ReadonlyArray<{ path: string; content: string }>,
  terms: readonly string[],
  allow: Readonly<Record<string, readonly string[]>> = {},
): Finding[] {
  const patterns = terms.map((term) => ({
    term,
    re: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, "u"),
  }));
  const findings: Finding[] = [];
  for (const file of files) {
    const allowed = new Set((allow[file.path] ?? []).map(normalize));
    normalize(file.content)
      .split("\n")
      .forEach((text, index) => {
        for (const { term, re } of patterns) {
          if (!allowed.has(term) && re.test(text)) findings.push({ file: file.path, line: index + 1, term });
        }
      });
  }
  return findings;
}

const SCANNED = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md)$/;

/** Lê os arquivos de texto de uma pasta, com caminhos relativos e separador `/`. */
export function readTree(root: string, base = root): Array<{ path: string; content: string }> {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = join(root, entry.name);
    if (entry.isDirectory()) return readTree(full, base);
    if (!SCANNED.test(entry.name)) return [];
    return [{ path: relative(base, full).split(sep).join("/"), content: readFileSync(full, "utf8") }];
  });
}
