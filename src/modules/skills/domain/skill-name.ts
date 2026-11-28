/**
 * Nome de habilidade sugerido (#15). É texto livre da pessoa que, se a coordenação nacional aprovar, vira
 * nome do catálogo, visível a todos os membros: por isso recusa caractere de controle e invisível
 * (largura zero, marcas de direção, hífen suave, BOM), como o nome completo (#312). Pura: sem banco nem rede.
 * O banco confere de novo (`app.valid_skill_name`).
 */
export const maxSkillsPerPerson = 10;
export const skillNameLimits = { min: 2, max: 80 } as const;

const FORBIDDEN = /[\p{Cc}\p{Cf}]/u;

/** O nome limpo (espaços das pontas tirados, os do meio juntos), ou null se não vale. */
export function parseSkillName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (FORBIDDEN.test(raw)) return null;
  const name = raw.trim().replace(/ {2,}/g, " ");
  const length = [...name].length;
  return length >= skillNameLimits.min && length <= skillNameLimits.max ? name : null;
}

/** Texto de busca na tela: minúsculo e sem acento, como `app.norm_text` no banco. */
export function normalizeSkillText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
