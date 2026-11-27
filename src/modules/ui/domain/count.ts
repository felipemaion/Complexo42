// Número que conta até o valor (22/11): quadro t (0 a 1) com saída rápida e chegada suave
// (cúbica). Puro; valor inválido ou negativo vira 0, e o último quadro é exatamente o valor.

export function easedCount(target: number, t: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  const progress = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - progress) ** 3;
  return Math.round(target * eased);
}
