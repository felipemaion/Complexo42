import "server-only";
import { z } from "zod";
import { TEAM_EMBLEMS, type TeamIdentity } from "../identity";
import type { CollabClient } from "../types";

// Identidade da equipe (#56): ler e gravar lema, cores e emblema. Quem pode editar quem decide é o
// banco (set_team_identity: líder da equipe ou coordenação do escopo).

export type IdentityError = "not_allowed" | "invalid" | "failed";
export type IdentityResult = { readonly ok: true } | { readonly ok: false; readonly error: IdentityError };

const hex = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/);

const identityRows = z.array(
  z.object({
    motto: z.string().nullable(),
    colors: z.array(hex).nullable(),
    emblem: z.enum(TEAM_EMBLEMS).nullable(),
  }),
);

const saveInput = z.object({
  teamId: z.guid(),
  motto: z.string().trim().max(80).catch(""),
  color1: hex,
  color2: hex,
  color3: hex.optional().catch(undefined),
  useColor3: z.unknown().optional(),
  emblem: z.enum(TEAM_EMBLEMS),
});

/** Identidade da equipe, ou null quando a pessoa não pode vê-la. */
export async function readTeamIdentity(client: CollabClient, teamId: string): Promise<TeamIdentity | null> {
  const { data, error } = await client.rpc("team_identity", { p_team: teamId });
  if (error) throw new Error("identity_read_failed");
  const parsed = identityRows.safeParse(data);
  if (!parsed.success) throw new Error("identity_read_failed");
  const row = parsed.data[0];
  if (!row) return null;
  return { motto: row.motto, colors: row.colors ?? [], emblem: row.emblem };
}

export async function saveTeamIdentity(client: CollabClient, input: unknown): Promise<IdentityResult> {
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { teamId, motto, color1, color2, color3, useColor3, emblem } = parsed.data;
  const colors = useColor3 && color3 ? [color1, color2, color3] : [color1, color2];

  const { error } = await client.rpc("set_team_identity", { p_team: teamId, p_motto: motto, p_colors: colors, p_emblem: emblem });
  if (!error) return { ok: true };
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "42501") return { ok: false, error: "not_allowed" };
  if (code === "22023") return { ok: false, error: "invalid" };
  return { ok: false, error: "failed" };
}
