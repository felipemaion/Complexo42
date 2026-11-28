// Formulário de publicar novidade (#307). Função pura: confere a forma antes de ir ao banco, que repete as mesmas
// regras (título até 80, texto até 280, sem `<` nem `>`, link só https com domínio, validade no futuro).
import { safeNewsLink } from "./news-feed";

export type NewsFormValue = { unitId: string; title: string; body: string; link: string | null; expiresAt: string | null };
export type NewsFormResult = { ok: true; value: NewsFormValue } | { ok: false; error: "invalid" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function text(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim() : null;
}

/** Fim do dia em Brasília (sem horário de verão desde 2019); `null` se a data não existe ou já passou. */
function endOfDay(day: string, now: Date): string | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  const iso = `${day}T23:59:59-03:00`;
  return new Date(iso).getTime() > now.getTime() ? iso : null;
}

/** Lê os campos do formulário (`unidade`, `titulo`, `texto`, `link`, `validade`); qualquer coisa fora da regra é "invalid". */
export function parseNewsForm(raw: Record<string, unknown>, now: Date = new Date()): NewsFormResult {
  const unit = text(raw.unidade);
  const title = text(raw.titulo);
  const body = text(raw.texto);
  const link = text(raw.link);
  const day = text(raw.validade);
  const invalid: NewsFormResult = { ok: false, error: "invalid" };
  if (unit === null || !UUID.test(unit)) return invalid;
  if (title === null || title.length < 1 || title.length > 80 || /[<>]/.test(title)) return invalid;
  if (body === null || body.length < 1 || body.length > 280 || /[<>]/.test(body)) return invalid;
  if (link === null || day === null) return invalid;
  if (link !== "" && safeNewsLink(link) === null) return invalid;
  const expiresAt = day === "" ? null : endOfDay(day, now);
  if (day !== "" && expiresAt === null) return invalid;
  return { ok: true, value: { unitId: unit, title, body, link: link === "" ? null : link, expiresAt } };
}
