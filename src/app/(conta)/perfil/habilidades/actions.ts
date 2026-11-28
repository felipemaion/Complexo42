"use server";
// Habilidades da pessoa (#15). Só composição: sessão (JWT, R14) e as funções do módulo; o banco decide
// (limite de 10, habilidade ativa, limites de sugestão) e a recusa volta como motivo, nunca como texto do banco.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessionHouseClient } from "@/modules/houses";
import { setMySkills, suggestSkill } from "@/modules/skills";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

const SKILLS_PATH = "/perfil/habilidades";

export async function saveSkillsAction(formData: FormData): Promise<void> {
  await requireUserClient();
  const client = await sessionHouseClient();
  if (!client) redirect(`${SKILLS_PATH}?erro=failed`);
  const skillIds = formData.getAll("habilidade").filter((value): value is string => typeof value === "string");
  const result = await setMySkills(client, { skillIds });
  if (!result.ok) {
    log.warn("skills_save_refused", { reason: result.error });
    redirect(`${SKILLS_PATH}?erro=${result.error}`);
  }
  revalidatePath(SKILLS_PATH);
  redirect(`${SKILLS_PATH}?salvo=1`);
}

export async function suggestSkillAction(formData: FormData): Promise<void> {
  await requireUserClient();
  const client = await sessionHouseClient();
  if (!client) redirect(`${SKILLS_PATH}?erro=failed`);
  const result = await suggestSkill(client, { name: formData.get("nome") });
  if (!result.ok) {
    log.warn("skill_suggestion_refused", { reason: result.error });
    redirect(`${SKILLS_PATH}?erro=${result.error}`);
  }
  revalidatePath(SKILLS_PATH);
  redirect(`${SKILLS_PATH}?sugerida=1`);
}
