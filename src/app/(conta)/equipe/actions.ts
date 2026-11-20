"use server";

import { redirect } from "next/navigation";
import {
  MY_TEAM_PATH,
  postMessage,
  sessionCollabClient,
} from "@/modules/collab";
import { requireUser } from "@/server/auth/session";
import { instance } from "@config/instance";
import { encryptField } from "@/server/crypto";
import { log } from "@/server/log";

export async function postMessageAction(formData: FormData): Promise<void> {
  await requireUser();

  if (!instance.teamChat.enabled) {
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
