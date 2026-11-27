"use server";
// Equipes de antes da plataforma (#136): a própria pessoa adiciona e tira; o banco confere quem.
import { redirect } from "next/navigation";
import { addPriorTeam, PRIOR_TEAMS_PATH, removePriorTeam, sessionTeamsClient } from "@/modules/teams";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export async function addPriorTeamAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${PRIOR_TEAMS_PATH}?erro=failed`);

  const result = await addPriorTeam(client, {
    teamName: formData.get("teamName") ?? "",
    period: formData.get("period") ?? "",
    role: formData.get("role"),
  });
  if (!result.ok) log.warn("prior_team_refused", { reason: result.error });
  redirect(`${PRIOR_TEAMS_PATH}?${result.ok ? "ok=added" : `erro=${result.error}`}`);
}

export async function removePriorTeamAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${PRIOR_TEAMS_PATH}?erro=failed`);

  const result = await removePriorTeam(client, formData.get("itemId"));
  if (!result.ok) log.warn("prior_team_refused", { reason: result.error });
  redirect(`${PRIOR_TEAMS_PATH}?${result.ok ? "ok=removed" : `erro=${result.error}`}`);
}
