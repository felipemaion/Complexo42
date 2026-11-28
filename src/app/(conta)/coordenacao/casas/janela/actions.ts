"use server";
// Abrir e fechar a janela de transferência de casa (#302, ADR 0016). Só composição: sessão (JWT, R14) e
// a função do banco, que confere que quem chama é a coordenação nacional (R15) e grava no audit_log.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { setTransferWindow, sessionHouseClient } from "@/modules/houses";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

const WINDOW_PATH = "/coordenacao/casas/janela";

export async function setTransferWindowAction(formData: FormData): Promise<void> {
  await requireUserClient();
  const client = await sessionHouseClient();
  const wanted = formData.get("estado");
  if (!client || (wanted !== "aberta" && wanted !== "fechada")) redirect(`${WINDOW_PATH}?erro=invalid`);
  const result = await setTransferWindow(client, { open: wanted === "aberta" });
  if (!result.ok) {
    log.warn("transfer_window_refused", { reason: result.error });
    redirect(`${WINDOW_PATH}?erro=${result.error}`);
  }
  revalidatePath(WINDOW_PATH);
  revalidatePath("/casa");
  redirect(WINDOW_PATH);
}
