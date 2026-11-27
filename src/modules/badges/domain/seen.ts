// Medalha nova = medalha que este navegador ainda não viu (celebração uma vez só). Puro; o
// armazenamento e o relógio entram por parâmetro, e falha de armazenamento vira "nada novo".
// - Sem medalha nenhuma, NADA é gravado no aparelho (ADR 0008: nada da pessoa fica no navegador à
//   toa; o teste do fluxo da casa confere que o armazenamento fica vazio). Achado em 22/11.
// - Primeira vez neste aparelho: só as medalhas dos últimos 7 dias são novidade (a primeira medalha
//   da vida ganha festa; as antigas, não).
// - Depois: só as que ainda não estavam na lista.
import type { KeyValueStore } from "@/modules/ui/domain/sound-pref";

export const SEEN_KEY = "c42-medalhas-vistas";
const MAX_REMEMBERED = 200;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export type SeenAward = { readonly id: string; readonly awardedAt: string };

function isRecent(awardedAt: string, now: number): boolean {
  const at = Date.parse(awardedAt);
  return Number.isFinite(at) && now - at <= RECENT_MS && at <= now + RECENT_MS;
}

export function takeNewAwards(
  awards: readonly SeenAward[],
  store: KeyValueStore | null | undefined,
  now: number = Date.now(),
): readonly string[] {
  if (awards.length === 0) return [];
  let seen: string[] | null = null;
  try {
    const raw = store?.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (raw && !Array.isArray(parsed)) return [];
    seen = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return [];
  }
  const known = seen;
  const fresh = known
    ? awards.filter((a) => !known.includes(a.id)).map((a) => a.id)
    : awards.filter((a) => isRecent(a.awardedAt, now)).map((a) => a.id);
  try {
    if (!store) return [];
    const ids = awards.map((a) => a.id);
    store.setItem(SEEN_KEY, JSON.stringify([...new Set([...(known ?? []), ...ids])].slice(-MAX_REMEMBERED)));
  } catch {
    return [];
  }
  return fresh;
}
