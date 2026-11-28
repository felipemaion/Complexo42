// Perfil público no servidor (#305). Usa o cliente com o JWT de quem está logado (R14): o banco decide quem vê
// (`public_profile` devolve zero linhas para "não existe", "inativo" e "sem permissão", sem distinguir). O nome vem
// cifrado e só é decifrado aqui. Nada daqui vai para log além de códigos (R11).
import "server-only";
import { z } from "zod";
import type { HouseClient } from "@/modules/houses";
import { completeBadgePrefs, isBadgeKind, type BadgeKind, type BadgePref } from "../domain/badges";

type Decrypt = (value: string, context: { table: string; column: string; rowId: string }) => Promise<string>;

export type PublicProfile = {
  id: string;
  /** O nome decifrado, ou nulo se não pôde ser lido. */
  name: string | null;
  hasPhoto: boolean;
  /** Só as medalhas que o dono deixa visíveis, na ordem dele. */
  badges: BadgeKind[];
};

const row = z.object({ profile_id: z.guid(), display_name_enc: z.string().nullable(), badges: z.array(z.string()) });

/** `null` para qualquer caso sem perfil a mostrar: a página responde 404 igual. */
export async function readPublicProfile(client: HouseClient, id: string, decrypt: Decrypt, options: { withPhoto: boolean }): Promise<PublicProfile | null> {
  if (!z.guid().safeParse(id).success) return null;
  const { data, error } = await client.rpc("public_profile", { p_id: id });
  if (error) return null;
  const rows = z.array(row).safeParse(data ?? []);
  const found = rows.success ? rows.data[0] : undefined;
  if (!found) return null;
  let name: string | null = null;
  if (found.display_name_enc) {
    try {
      name = await decrypt(found.display_name_enc, { table: "profiles", column: "display_name_enc", rowId: found.profile_id });
    } catch {
      name = null;
    }
  }
  let hasPhoto = false;
  if (options.withPhoto) {
    const photo = await client.from("profile_photos").select("profile_id").eq("profile_id", found.profile_id).maybeSingle();
    hasPhoto = !photo.error && photo.data !== null;
  }
  return { id: found.profile_id, name, hasPhoto, badges: found.badges.filter(isBadgeKind) };
}

const prefRow = z.object({ badge_kind: z.string(), shown: z.boolean() });

/** As escolhas do dono (a RLS só deixa ler as próprias), completas: tipo ainda sem escolha entra no fim. */
export async function readOwnBadgePrefs(client: HouseClient, userId: string): Promise<BadgePref[]> {
  if (!z.guid().safeParse(userId).success) return completeBadgePrefs([]);
  const { data, error } = await client.from("profile_badge_prefs").select("badge_kind,shown").eq("profile_id", userId).order("position", { ascending: true });
  if (error) return completeBadgePrefs([]);
  const rows = z.array(prefRow).safeParse(data ?? []);
  if (!rows.success) return completeBadgePrefs([]);
  return completeBadgePrefs(rows.data.flatMap((r) => (isBadgeKind(r.badge_kind) ? [{ kind: r.badge_kind, shown: r.shown }] : [])));
}

export type SaveBadgePrefsError = "invalid" | "forbidden" | "failed";

const errorByCode: Record<string, SaveBadgePrefsError> = { "22023": "invalid", "42501": "forbidden" };

export async function saveBadgePrefs(client: HouseClient, prefs: readonly BadgePref[]): Promise<{ ok: true } | { ok: false; error: SaveBadgePrefsError }> {
  const { error } = await client.rpc("set_my_badge_prefs", { p_kinds: prefs.map((p) => p.kind), p_shown: prefs.map((p) => p.shown) });
  if (!error) return { ok: true };
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return { ok: false, error: (typeof code === "string" && errorByCode[code]) || "failed" };
}
