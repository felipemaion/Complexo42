"use server";

import { redirect } from "next/navigation";
import { sessionCollabClient, submitEvaluation } from "@/modules/collab";
import { requireUser } from "@/server/auth/session";
import { evaluationsEnabled } from "@/modules/collab";
import { encryptField } from "@/server/crypto";
import { log } from "@/server/log";

export async function evaluateAction(formData: FormData): Promise<void> {
  await requireUser();

  if (!evaluationsEnabled()) {
    redirect("/coordenacao/equipes?erro=not_allowed");
  }

  const client = await sessionCollabClient();
  if (!client) {
    redirect("/coordenacao/equipes?erro=failed");
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await submitEvaluation(
    client,
    {
      profileId: formData.get("profileId"),
      grade: formData.get("grade"),
      note: formData.get("note"),
    },
    (value, column, profileId) =>
      encryptField(value, {
        table: "member_evaluations",
        column,
        rowId: profileId,
      }),
    today,
  );

  if (!result.ok) {
    log.warn("collab_action_refused", { reason: result.error });
    const normalizedError = result.error === "too_many" ? "failed" : result.error;
    redirect(`/coordenacao/equipes?erro=${normalizedError}`);
  }

  redirect("/coordenacao/equipes?ok=evaluated");
}
