"use server";
// Ações da coordenação nas missões (ADR 0006 §4–§5, #32 e #33). O banco decide quem pode
// validar e publicar (R15): estas funções só validam a entrada e devolvem um código na URL.
import { redirect } from "next/navigation";
import { instance } from "@config/instance";
import {
  decideProposal,
  MISSION_PUBLISH_PATH,
  MISSION_REVIEW_PATH,
  missionPath,
  publishMission,
  reviewSubmission,
  sessionMissionClient,
} from "@/modules/missions";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

const stepNumbers = [1, 2, 3] as const;

export async function reviewSubmissionAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionMissionClient();
  if (!client) redirect(`${MISSION_REVIEW_PATH}?erro=failed`);
  const note = formData.get("note");
  const result = await reviewSubmission(client, {
    submissionId: formData.get("submissionId"),
    decision: formData.get("decision"),
    ...(typeof note === "string" && note.trim() ? { note } : {}),
  });
  if (!result.ok) log.warn("mission_review_refused", { reason: result.error });
  redirect(`${MISSION_REVIEW_PATH}?${result.ok ? `ok=${result.value}` : `erro=${result.error}`}`);
}

/** Lê as até 3 etapas do formulário: só entram as que têm o que fazer escrito. */
function stepsFrom(formData: FormData): { title: unknown; points: unknown; evidenceType: unknown }[] {
  return stepNumbers
    .map((n) => ({
      title: formData.get(`step${n}Title`),
      points: formData.get(`step${n}Points`),
      evidenceType: formData.get(`step${n}Evidence`),
    }))
    .filter((step) => typeof step.title === "string" && step.title.trim() !== "");
}

export async function publishMissionAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionMissionClient();
  if (!client) redirect(`${MISSION_PUBLISH_PATH}?erro=failed`);
  const result = await publishMission(
    client,
    {
      title: formData.get("title"),
      description: formData.get("description") ?? "",
      category: formData.get("category"),
      scopeUnitId: formData.get("scopeUnitId"),
      mode: formData.get("mode"),
      steps: stepsFrom(formData),
    },
    Object.keys(instance.missions.publish.categories),
  );
  if (!result.ok) {
    log.warn("mission_publish_refused", { reason: result.error });
    const code = result.error === "invalid" || result.error === "not_allowed" ? result.error : "failed";
    redirect(`${MISSION_PUBLISH_PATH}?erro=${code}`);
  }
  redirect(`${missionPath(result.value)}?ok=published`);
}

// Propostas das equipes (#57): aprovar (com escopo e pontos ajustados) ou recusar com justificativa.
export async function decideProposalAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionMissionClient();
  if (!client) redirect(`${MISSION_REVIEW_PATH}?erro_proposta=failed`);
  const result = await decideProposal(client, {
    missionId: formData.get("missionId"),
    decision: formData.get("decision"),
    scopeUnitId: formData.get("scopeUnitId") ?? "",
    points: formData.getAll("points"),
    note: formData.get("note") ?? "",
  });
  if (!result.ok) log.warn("proposal_decision_refused", { reason: result.error });
  const done = formData.get("decision") === "approve" ? "approved" : "rejected";
  redirect(`${MISSION_REVIEW_PATH}?${result.ok ? `proposta=${done}` : `erro_proposta=${result.error}`}`);
}
