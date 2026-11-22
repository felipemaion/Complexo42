"use server";
// A pessoa salva as próprias habilidades (#15); o banco confere quem e o que vale.
import { redirect } from "next/navigation";
import { MY_SKILLS_PATH, saveMySkills, sessionSearchClient } from "@/modules/search";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export async function saveMySkillsAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionSearchClient();
  if (!client) redirect(`${MY_SKILLS_PATH}?erro=failed`);

  const result = await saveMySkills(client, formData.getAll("skill"));
  if (!result.ok) log.warn("my_skills_refused", { reason: result.error });
  redirect(`${MY_SKILLS_PATH}?${result.ok ? "ok=1" : `erro=${result.error}`}`);
}
