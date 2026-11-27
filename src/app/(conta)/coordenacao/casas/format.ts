import { instance } from "@config/instance";

/** Troca `{chave}` pelos valores no texto da config. */
export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

/** Data curta no fuso de Brasília (a pessoa lê no calendário dela, não no do servidor). */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** Nome da casa pelo id da config (o id é a chave do banco). */
export function houseName(houseId: string): string {
  return instance.houses.find((house) => house.id === houseId)?.name ?? houseId;
}

/** Texto do erro pelo código da URL: só chave própria do objeto vale (nunca `__proto__`, `constructor` etc.). */
export function errorText(errors: Readonly<Record<string, string>>, code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(errors, code) ? errors[code]! : null;
}
