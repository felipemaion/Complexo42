"use server";
// Draft do 2º ciclo (ata de 17/11 §6) e pedido auditado de acesso à avaliação (ADR 0007 §4).
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import { closeDraft, type EvaluationAccessState, openDraft, requestEvaluationAccess, sessionCollabClient } from "@/modules/collab";
import { TEAMS_PATH } from "@/modules/teams";
import { requireUser } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { log } from "@/server/log";

export async function openDraftAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionCollabClient();
  if (!client) redirect(`${TEAMS_PATH}?erro_draft=failed`);
  const result = await openDraft(client, {
    parentId: formData.get("parentId"),
    teamIds: formData.getAll("teamIds"),
    sliceSize: formData.get("sliceSize"),
  });
  if (!result.ok) log.warn("draft_action_refused", { reason: result.error });
  redirect(`${TEAMS_PATH}?${result.ok ? "ok_draft=opened" : `erro_draft=${result.error === "too_many" ? "failed" : result.error}`}`);
}

export async function closeDraftAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionCollabClient();
  if (!client) redirect(`${TEAMS_PATH}?erro_draft=failed`);
  const result = await closeDraft(client, { sessionId: formData.get("sessionId") });
  if (!result.ok) log.warn("draft_action_refused", { reason: result.error });
  redirect(`${TEAMS_PATH}?${result.ok ? "ok_draft=closed" : `erro_draft=${result.error === "too_many" ? "failed" : result.error}`}`);
}

export async function evaluationAccessAction(_state: EvaluationAccessState, formData: FormData): Promise<EvaluationAccessState> {
  await requireUser();
  // Segue a mesma chave da avaliação: desligada até o parecer do jurídico (ADR 0007 §4).
  if (!instance.evaluations.enabled) return { status: "error", error: "not_allowed" };
  const client = await sessionCollabClient();
  if (!client) return { status: "error", error: "failed" };
  const result = await requestEvaluationAccess(
    client,
    { profileId: formData.get("profileId"), reason: formData.get("reason") },
    (value, column, profileId) => decryptField(value, { table: "member_evaluations", column, rowId: profileId }),
  );
  if (!result.ok) {
    log.warn("evaluation_access_refused", { reason: result.error });
    return { status: "error", error: result.error };
  }
  return { status: "ok", rows: result.value };
}
