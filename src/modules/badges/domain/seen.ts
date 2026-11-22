// Medalha nova = id que este navegador ainda não viu (celebração uma vez só). Na primeira visita
// tudo vira "visto" sem festa: medalha antiga não é novidade. Puro; o armazenamento entra por
// parâmetro e falha vira "nada novo".
import type { KeyValueStore } from "@/modules/ui/domain/sound-pref";

export const SEEN_KEY = "c42-medalhas-vistas";
const MAX_REMEMBERED = 200;

export function takeNewAwards(ids: readonly string[], store: KeyValueStore | null | undefined): readonly string[] {
  let seen: string[] | null = null;
  try {
    const raw = store?.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    seen = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return [];
  }
  const known = seen;
  const fresh = known ? ids.filter((id) => !known.includes(id)) : [];
  try {
    store?.setItem(SEEN_KEY, JSON.stringify([...new Set([...(known ?? []), ...ids])].slice(-MAX_REMEMBERED)));
  } catch {
    return [];
  }
  return fresh;
}
