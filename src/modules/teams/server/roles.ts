import "server-only";
import { z } from "zod";
import { log } from "@/server/log";

// Delegar papéis pela tela (#22, ADR 0002): só para baixo, dentro do escopo, nunca a si mesmo.
// Quem pode o banco decide (grant_role / revoke_role); papel técnico nunca pela tela.

export const DELEGABLE_ROLES = ["monitor", "spokesperson", "manager"] as const;
export type DelegableRole = (typeof DELEGABLE_ROLES)[number];

export type RolesClient = {
  readonly rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};
export type RoleError = "invalid" | "not_allowed" | "already" | "failed";
export type RoleResult = { readonly ok: true } | { readonly ok: false; readonly error: RoleError };
export type ScopeRole = {
  readonly id: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly role: string;
  readonly unitId: string;
  readonly unitName: string;
};

function mapError(error: unknown): RoleError {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "42501") return "not_allowed";
  if (code === "23505") return "already";
  return "failed";
}

export async function grantRole(client: RolesClient, input: unknown): Promise<RoleResult> {
  const parsed = z.object({ profileId: z.guid(), role: z.enum(DELEGABLE_ROLES), unitId: z.guid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("grant_role", { p_profile: parsed.data.profileId, p_role: parsed.data.role, p_unit: parsed.data.unitId });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

export async function revokeRole(client: RolesClient, assignmentId: unknown): Promise<RoleResult> {
  const parsed = z.guid().safeParse(assignmentId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("revoke_role", { p_assignment: parsed.data });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

export async function readRolesInScope(
  client: RolesClient,
  decryptName: (value: string, profileId: string) => Promise<string>,
): Promise<readonly ScopeRole[]> {
  const { data, error } = await client.rpc("roles_in_my_scope", {});
  if (error) throw new Error("roles_read_failed");
  const rows = z
    .array(z.object({ id: z.guid(), profile_id: z.guid(), display_name_enc: z.string(), role: z.string(), unit_id: z.guid(), unit_name: z.string() }))
    .parse(data);
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      profileId: row.profile_id,
      displayName: await decryptName(row.display_name_enc, row.profile_id).catch((decryptError: unknown) => {
        log.warn("roles_unreadable_name", { error: String(decryptError) });
        return "—";
      }),
      role: row.role,
      unitId: row.unit_id,
      unitName: row.unit_name,
    })),
  );
}
