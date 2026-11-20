"use server";
// Delegar papéis pela tela (#22): o banco confere o escopo e registra no audit_log.
import { redirect } from "next/navigation";
import { grantRole, revokeRole, ROLES_PATH, sessionTeamsClient } from "@/modules/teams";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export async function grantRoleAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${ROLES_PATH}?erro=failed`);
  // "pessoa:equipe" vem de um campo só (a equipe é a da própria pessoa); a validação fica no grantRole.
  const [profileId, unitId] = String(formData.get("personInTeam") ?? "").split(":");
  const result = await grantRole(client, { profileId, role: formData.get("role"), unitId });
  if (!result.ok) log.warn("role_grant_refused", { reason: result.error });
  redirect(`${ROLES_PATH}?${result.ok ? "ok=granted" : `erro=${result.error}`}`);
}

export async function revokeRoleAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${ROLES_PATH}?erro=failed`);
  const result = await revokeRole(client, formData.get("assignmentId"));
  if (!result.ok) log.warn("role_revoke_refused", { reason: result.error });
  redirect(`${ROLES_PATH}?${result.ok ? "ok=revoked" : `erro=${result.error}`}`);
}
