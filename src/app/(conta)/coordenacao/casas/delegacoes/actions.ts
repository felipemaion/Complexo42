"use server";
// Conceder e revogar a delegação do acesso ao questionário (#174, ADR 0014). Só composição: sessão
// (JWT, R14) e as funções existentes; o banco decide (só a coordenação nacional, R15) e audita.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { grantQuestionnaireAccess, revokeQuestionnaireAccess, sessionHouseClient } from "@/modules/houses";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

const DELEGATIONS_PATH = "/coordenacao/casas/delegacoes";

const pair = z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i);

export async function grantDelegationAction(formData: FormData): Promise<void> {
  await requireUserClient();
  const client = await sessionHouseClient();
  const chosen = pair.safeParse(formData.get("gestor"));
  if (!client || !chosen.success) redirect(`${DELEGATIONS_PATH}?erro=invalid`);
  const [granteeId, unitId] = chosen.data.split(":");
  const result = await grantQuestionnaireAccess(client, { granteeId, unitId });
  if (!result.ok) {
    log.warn("questionnaire_grant_refused", { reason: result.error });
    redirect(`${DELEGATIONS_PATH}?erro=${result.error}`);
  }
  revalidatePath(DELEGATIONS_PATH);
  redirect(`${DELEGATIONS_PATH}?concedida=1`);
}

export async function revokeDelegationAction(formData: FormData): Promise<void> {
  await requireUserClient();
  const client = await sessionHouseClient();
  const grantId = z.uuid().safeParse(formData.get("concessao"));
  if (!client || !grantId.success) redirect(`${DELEGATIONS_PATH}?erro=invalid`);
  const result = await revokeQuestionnaireAccess(client, { grantId: grantId.data });
  if (!result.ok) {
    log.warn("questionnaire_revoke_refused", { reason: result.error });
    redirect(`${DELEGATIONS_PATH}?erro=${result.error}`);
  }
  revalidatePath(DELEGATIONS_PATH);
  redirect(`${DELEGATIONS_PATH}?revogada=1`);
}
