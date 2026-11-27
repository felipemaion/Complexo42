"use server";
// Resolver um caso da fila de análise (#174, ADR 0014). Só composição: sessão (JWT, R14), o servidor
// refaz as notas das respostas, cifra e assina a resolução (hash incluso) e o banco decide quem pode
// (a nacional ou o delegado no escopo, R15). Nada de respostas nem de totem no log (R11).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { instance } from "@config/instance";
import { coordinationViewDeps, resolveAnalysis } from "@/modules/houses";
import { requireUserClient } from "@/server/auth/session";
import { sessionHouseClient } from "@/modules/houses";
import { sha256Hex, signQuestionnaireMessage } from "@/server/crypto";
import { log } from "@/server/log";

const QUEUE_PATH = "/coordenacao/casas/analise";

export async function resolveCaseAction(formData: FormData): Promise<void> {
  const { user } = await requireUserClient();
  const requestId = z.uuid().safeParse(formData.get("pedido"));
  const back = requestId.success ? `${QUEUE_PATH}/${requestId.data}` : QUEUE_PATH;
  const client = await sessionHouseClient();
  if (!client || !requestId.success) redirect(`${back}?erro=failed`);
  const deps = coordinationViewDeps();
  const result = await resolveAnalysis(
    client,
    { requestId: requestId.data, houseId: formData.get("casa"), totem: formData.get("totem") },
    {
      houseIds: instance.houses.map((house) => house.id),
      questionnaire: deps.questionnaire,
      crypto: deps.crypto,
      signing: { userId: user.id, nowSeconds: Math.floor(Date.now() / 1000), sign: signQuestionnaireMessage, sha256Hex },
    },
  );
  if (!result.ok) {
    log.warn("questionnaire_resolve_refused", { reason: result.error });
    redirect(`${back}?erro=${result.error}`);
  }
  revalidatePath(QUEUE_PATH);
  redirect(`${QUEUE_PATH}?resolvido=1`);
}
