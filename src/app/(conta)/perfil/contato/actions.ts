"use server";
// Server action de "Quem vê meu contato" (#119). Só composição: sessão (JWT da pessoa) + serviço
// do módulo de perfis, que valida (Zod) e grava pela função `set_contact_visibility`. Depois
// volta para a tela, que lê a escolha de novo do banco: a mudança aparece e vale na hora.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CONTACT_VISIBILITY_PATH, CONTACT_VISIBILITY_STATUS_PARAM, setContactVisibility } from "@/modules/profiles";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

export async function setContactVisibilityAction(formData: FormData): Promise<void> {
  const { client } = await requireUserClient();
  const result = await setContactVisibility(client, { kind: formData.get("kind"), scope: formData.get("scope") });
  // Bloqueado: requireUser encerra a sessão na próxima página.
  if (result.status === "forbidden") redirect(HOME_PATH);
  revalidatePath(CONTACT_VISIBILITY_PATH);
  const status = result.status === "saved" ? "salva" : "erro";
  redirect(`${CONTACT_VISIBILITY_PATH}?${CONTACT_VISIBILITY_STATUS_PARAM}=${status}`);
}
