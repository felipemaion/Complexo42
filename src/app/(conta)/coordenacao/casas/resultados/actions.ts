"use server";
// Trocar a casa de uma pessoa pela coordenação (ADR 0016). Só composição: sessão (JWT, R14) e o
// banco decide o alcance sobre a pessoa, a casa e mantém a trava dela (R15). Troca fica no audit_log.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { instance } from "@config/instance";
import { changeHouse, sessionHouseClient } from "@/modules/houses";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

const RESULTS_PATH = "/coordenacao/casas/resultados";

export async function changeHouseAction(formData: FormData): Promise<void> {
  await requireUserClient();
  const personId = z.uuid().safeParse(formData.get("pessoa"));
  const back = personId.success ? `${RESULTS_PATH}/${personId.data}` : RESULTS_PATH;
  const client = await sessionHouseClient();
  if (!client || !personId.success) redirect(`${back}?erro=failed`);
  const result = await changeHouse(client, { profileId: personId.data, houseId: formData.get("casa") }, instance.houses.map((h) => h.id));
  if (!result.ok) {
    log.warn("house_change_refused", { reason: result.error });
    redirect(`${back}?erro=${result.error}`);
  }
  revalidatePath(RESULTS_PATH);
  redirect(`${back}?trocada=1`);
}
