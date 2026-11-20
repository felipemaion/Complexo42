"use server";

import { redirect } from "next/navigation";
import {
  assignToTeam,
  createTeam,
  moveToTeam,
  removeFromTeam,
  sessionTeamsClient,
  setTeamLead,
  TEAMS_PATH,
} from "@/modules/teams";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export async function createTeamAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${TEAMS_PATH}?erro=failed`);

  const result = await createTeam(client, {
    parentId: formData.get("parentId"),
    name: formData.get("name"),
  });

  if (!result.ok) log.warn("team_action_refused", { reason: result.error });
  redirect(`${TEAMS_PATH}?${result.ok ? "ok=created" : `erro=${result.error}`}`);
}

export async function assignAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${TEAMS_PATH}?erro=failed`);

  const result = await assignToTeam(client, {
    profileId: formData.get("profileId"),
    teamId: formData.get("teamId"),
  });

  if (!result.ok) log.warn("team_action_refused", { reason: result.error });
  redirect(`${TEAMS_PATH}?${result.ok ? "ok=assigned" : `erro=${result.error}`}`);
}

export async function removeAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${TEAMS_PATH}?erro=failed`);

  const result = await removeFromTeam(client, {
    profileId: formData.get("profileId"),
    teamId: formData.get("teamId"),
  });

  if (!result.ok) log.warn("team_action_refused", { reason: result.error });
  redirect(`${TEAMS_PATH}?${result.ok ? "ok=removed" : `erro=${result.error}`}`);
}

export async function leadAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${TEAMS_PATH}?erro=failed`);

  const result = await setTeamLead(client, {
    profileId: formData.get("profileId"),
    teamId: formData.get("teamId"),
  });

  if (!result.ok) log.warn("team_action_refused", { reason: result.error });
  redirect(`${TEAMS_PATH}?${result.ok ? "ok=lead" : `erro=${result.error}`}`);
}

// Mover pessoa entre equipes (#47): o banco confere o escopo e registra member_moved.
export async function moveAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionTeamsClient();
  if (!client) redirect(`${TEAMS_PATH}?erro=failed`);
  const result = await moveToTeam(client, {
    profileId: formData.get("profileId"),
    fromTeamId: formData.get("fromTeamId"),
    toTeamId: formData.get("toTeamId"),
  });
  if (!result.ok) log.warn("team_action_refused", { reason: result.error });
  redirect(`${TEAMS_PATH}?${result.ok ? "ok=moved" : `erro=${result.error}`}`);
}
