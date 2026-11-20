"use server";

import { redirect } from "next/navigation";
import {
  MY_TEAM_PATH,
  pickInDraft,
  postMessage,
  sessionCollabClient,
} from "@/modules/collab";
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
