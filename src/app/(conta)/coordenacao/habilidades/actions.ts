"use server";
// Catálogo de habilidades (#25): só o gestor nacional; o banco confere.
import { redirect } from "next/navigation";
import { saveSkill, sessionSearchClient, SKILLS_CATALOG_PATH, toggleSkill } from "@/modules/search";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export async function saveSkillAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionSearchClient();
  if (!client) redirect(`${SKILLS_CATALOG_PATH}?erro=failed`);
  const result = await saveSkill(client, {
    skillId: formData.get("skillId") ?? "",
    name: formData.get("name") ?? "",
    category: formData.get("category") ?? "",
    aliases: formData.get("aliases") ?? "",
  });
  if (!result.ok) log.warn("skill_catalog_refused", { reason: result.error });
  redirect(`${SKILLS_CATALOG_PATH}?${result.ok ? "ok=1" : `erro=${result.error}`}`);
}

export async function toggleSkillAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionSearchClient();
  if (!client) redirect(`${SKILLS_CATALOG_PATH}?erro=failed`);
  const result = await toggleSkill(client, { skillId: formData.get("skillId"), active: formData.get("active") });
  if (!result.ok) log.warn("skill_catalog_refused", { reason: result.error });
  redirect(`${SKILLS_CATALOG_PATH}?${result.ok ? "ok=1" : `erro=${result.error}`}`);
}
