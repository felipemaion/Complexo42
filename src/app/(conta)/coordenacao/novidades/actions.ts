"use server";
// Publicar e arquivar novidades da página inicial (#307). Só composição: sessão (JWT, R14), o formulário conferido
// e as funções do banco, que decidem quem pode (gestor com escopo, R15) e gravam o audit_log (sem o texto).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { readCoordinationMenu } from "@/modules/access";
import { archiveNews, parseNewsForm, publishNews, sessionHouseClient } from "@/modules/houses";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

const NEWS_ADMIN_PATH = "/coordenacao/novidades";

async function requireManager() {
  const { user, client } = await requireUserClient();
  // Conforto, não segurança (R15): o banco recusa quem não é gestor da unidade.
  const menu = await readCoordinationMenu(client, user.id);
  const houseClient = await sessionHouseClient();
  if (!menu.waitlist || !houseClient) redirect(HOME_PATH);
  return houseClient;
}

export async function publishNewsAction(formData: FormData): Promise<void> {
  const client = await requireManager();
  const parsed = parseNewsForm(Object.fromEntries(formData));
  if (!parsed.ok) redirect(`${NEWS_ADMIN_PATH}?erro=invalid`);
  const result = await publishNews(client, parsed.value);
  if (!result.ok) {
    log.warn("news_publish_refused", { reason: result.error });
    redirect(`${NEWS_ADMIN_PATH}?erro=${result.error}`);
  }
  revalidatePath(NEWS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
  redirect(`${NEWS_ADMIN_PATH}?ok=publicada`);
}

export async function archiveNewsAction(formData: FormData): Promise<void> {
  const client = await requireManager();
  const result = await archiveNews(client, { id: formData.get("id") });
  if (!result.ok) {
    log.warn("news_archive_refused", { reason: result.error });
    redirect(`${NEWS_ADMIN_PATH}?erro=${result.error}`);
  }
  revalidatePath(NEWS_ADMIN_PATH);
  revalidatePath(HOME_PATH);
  redirect(`${NEWS_ADMIN_PATH}?ok=arquivada`);
}
