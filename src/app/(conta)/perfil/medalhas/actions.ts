"use server";
// Medalhas do perfil público (#305). Só composição: sessão (JWT, R14), leitura do formulário e a função do módulo;
// o banco decide quem pode e confere a lista, e a recusa volta como motivo, nunca como texto do banco.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessionHouseClient } from "@/modules/houses";
import { parseBadgeForm, saveBadgePrefs } from "@/modules/public-profile";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

const BADGES_PATH = "/perfil/medalhas";

export async function saveBadgePrefsAction(formData: FormData): Promise<void> {
  await requireUserClient();
  const client = await sessionHouseClient();
  if (!client) redirect(`${BADGES_PATH}?erro=failed`);
  const prefs = parseBadgeForm(formData);
  if (!prefs) redirect(`${BADGES_PATH}?erro=invalid`);
  const result = await saveBadgePrefs(client, prefs);
  if (!result.ok) {
    log.warn("badge_prefs_refused", { reason: result.error });
    redirect(`${BADGES_PATH}?erro=${result.error}`);
  }
  revalidatePath(BADGES_PATH);
  redirect(`${BADGES_PATH}?salvo=1`);
}
