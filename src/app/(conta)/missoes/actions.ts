"use server";
// Ações da missão de quem participa (ADR 0006 §3, #31). O navegador manda só ids e o
// comprovante; o tipo de comprovante vem da etapa lida no servidor, e o banco confere tudo de
// novo (R15). O resultado volta como código na URL; o texto vem da config (R17).
import { redirect } from "next/navigation";
import { missionPath, readMission, sessionMissionClient, startRun, submitStep } from "@/modules/missions";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

function back(missionId: unknown, query: string): never {
  redirect(`${missionPath(missionId)}?${query}`);
}

export async function startMissionAction(formData: FormData): Promise<void> {
  await requireUser();
  const missionId = formData.get("missionId");
  const client = await sessionMissionClient();
  if (!client) back(missionId, "erro=failed");
  const result = await startRun(client, missionId);
  // Só o código do motivo no log: nada da pessoa (R11).
  if (!result.ok) log.warn("mission_start_refused", { reason: result.error });
  back(missionId, result.ok ? "ok=started" : `erro=${result.error}`);
}

export async function submitStepAction(formData: FormData): Promise<void> {
  await requireUser();
  const missionId = formData.get("missionId");
  const client = await sessionMissionClient();
  if (!client) back(missionId, "erro=failed");
  const found = await readMission(client, missionId);
  const step = found?.steps.find((s) => s.id === formData.get("stepId"));
  if (!step) back(missionId, "erro=unavailable");
  const result = await submitStep(client, {
    runId: formData.get("runId"),
    step,
    url: formData.get("url"),
    text: formData.get("text"),
  });
  if (!result.ok) log.warn("mission_submit_refused", { reason: result.error });
  back(missionId, result.ok ? "ok=submitted" : `erro=${result.error}`);
}
