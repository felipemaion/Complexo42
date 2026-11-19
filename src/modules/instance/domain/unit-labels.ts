import { z } from "zod";

/** Linha de `unit_types` que a interface precisa: a chave genérica e o rótulo da instância. */
const unitTypeRowSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  level: z.number().int().min(0),
});

export type UnitTypeRow = z.infer<typeof unitTypeRowSchema>;

/** Rótulos dos tipos de unidade, ordenados do mais alto da árvore (nível 0) para baixo. */
export type UnitTypeLabels = readonly UnitTypeRow[];

/**
 * Valida o que o banco devolveu de `unit_types` (ADR 0005 §3: os rótulos vêm de
 * `unit_types.label`, nunca de texto fixo). Resposta fora do formato → null, para quem chama
 * tratar como erro em vez de mostrar uma lista vazia.
 */
export function parseUnitTypeLabels(rows: unknown): UnitTypeLabels | null {
  const parsed = z.array(unitTypeRowSchema).safeParse(rows);
  if (!parsed.success) return null;
  return [...parsed.data].sort((a, b) => a.level - b.level);
}

/**
 * Rótulo de um tipo. Tipo que o banco não tem devolve a própria chave: aparece estranho na
 * tela (e alguém nota) em vez de sumir ou de usar um nome inventado.
 */
export function unitTypeLabel(labels: UnitTypeLabels, key: string): string {
  return labels.find((type) => type.key === key)?.label ?? key;
}
