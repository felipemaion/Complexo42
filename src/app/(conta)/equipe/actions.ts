"use server";

import { redirect } from "next/navigation";
import {
  MY_TEAM_PATH,
  pickInDraft,
  postMessage,
  saveTeamIdentity,
  sessionCollabClient,
} from "@/modules/collab";
import { instance } from "@config/instance";
import { proposeMission, sessionMissionClient } from "@/modules/missions";
import { requireUser } from "@/server/auth/session";
import { teamChatEnabled } from "@/modules/collab";
import { encryptField } from "@/server/crypto";
import { log } from "@/server/log";

export async function postMessageAction(formData: FormData): Promise<void> {
  await requireUser();

  if (!teamChatEnabled()) {
    redirect(`${MY_TEAM_PATH}?erro=not_allowed`);
  }

  const client = await sessionCollabClient();
  if (!client) {
    redirect(`${MY_TEAM_PATH}?erro=failed`);
  }

  const result = await postMessage(
    client,
    {
      teamId: formData.get("teamId"),
      body: formData.get("body"),
    },
    (body, teamId) =>
      encryptField(body, {
        table: "team_messages",
        column: "body_enc",
        rowId: teamId,
      }),
  );

  if (!result.ok) {
    log.warn("collab_action_refused", { reason: result.error });
  }

  redirect(`${MY_TEAM_PATH}?${result.ok ? "ok=sent" : `erro=${result.error}`}`);
}

// Draft do 2º ciclo (ata de 17/11 §6): o coordenador da equipe escolhe na sua vez.
export async function pickInDraftAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionCollabClient();
  if (!client) redirect(`${MY_TEAM_PATH}?erro_draft=failed`);
  const result = await pickInDraft(client, { sessionId: formData.get("sessionId"), profileId: formData.get("profileId") });
  if (!result.ok) log.warn("draft_action_refused", { reason: result.error });
  redirect(`${MY_TEAM_PATH}?${result.ok ? "ok_draft=picked" : `erro_draft=${result.error === "too_many" ? "failed" : result.error}`}`);
}

// Identidade da equipe (#56): lema, cores e emblema. Quem pode o banco decide.
export async function saveIdentityAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionCollabClient();
  if (!client) redirect(`${MY_TEAM_PATH}?erro_identidade=failed`);

  const result = await saveTeamIdentity(client, {
    teamId: formData.get("teamId"),
    motto: formData.get("motto") ?? "",
    color1: formData.get("color1"),
    color2: formData.get("color2"),
    color3: formData.get("color3") ?? undefined,
    useColor3: formData.get("useColor3") ?? undefined,
    emblem: formData.get("emblem"),
  });

  if (!result.ok) log.warn("identity_action_refused", { reason: result.error });
  redirect(`${MY_TEAM_PATH}?${result.ok ? "identidade=salva" : `erro_identidade=${result.error}`}`);
}

// Propostas de missão pela equipe (#57): a equipe sugere, a coordenação decide.
export async function proposeMissionAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionMissionClient();
  if (!client) redirect(`${MY_TEAM_PATH}?erro_proposta=failed`);
  const steps = [1, 2, 3]
    .map((n) => ({ title: formData.get(`step${n}Title`), points: formData.get(`step${n}Points`), evidenceType: formData.get(`step${n}Evidence`) }))
    .filter((step) => typeof step.title === "string" && step.title.trim() !== "");
  const result = await proposeMission(
    client,
    { title: formData.get("title"), description: formData.get("description") ?? "", category: formData.get("category"), steps },
    Object.keys(instance.missions.publish.categories),
  );
  if (!result.ok) log.warn("proposal_refused", { reason: result.error });
  redirect(`${MY_TEAM_PATH}?${result.ok ? "proposta=enviada" : `erro_proposta=${result.error}`}`);
}
