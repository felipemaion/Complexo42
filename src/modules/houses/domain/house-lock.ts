/*
 * Trava de 4 meses para trocar de casa (ADR 0015). Quem decide é o banco (`accept_house` compara
 * `locked_until` com o relógio do servidor); aqui só se escreve o aviso da tela, para a pessoa
 * saber a partir de quando poderá trocar. Sem trava lida, ou já vencida, não há aviso.
 */

const brazilDay = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/** "27/03/2027": o dia em Brasília de um instante ISO. */
export function formatLockDate(iso: string): string {
  return brazilDay.format(new Date(iso));
}

/** O aviso com a data (`{date}` no texto da config), ou nulo se não há trava ativa ou a data é inválida. */
export function houseLockNotice(template: string, lockedUntil: string | null, now: Date): string | null {
  if (lockedUntil === null) return null;
  const until = new Date(lockedUntil);
  if (Number.isNaN(until.getTime()) || now.getTime() >= until.getTime()) return null;
  return template.replaceAll("{date}", formatLockDate(lockedUntil));
}

/** A pessoa já pode trocar de casa por conta própria (sem trava lida, ou vencida). */
export function canChangeHouse(lockedUntil: string | null, now: Date): boolean {
  if (lockedUntil === null) return true;
  const until = new Date(lockedUntil);
  return Number.isNaN(until.getTime()) || now.getTime() >= until.getTime();
}
