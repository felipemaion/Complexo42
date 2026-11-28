"use server";
// Gestão do catálogo de habilidades (#25). O guard da tela vale aqui também: a ação é um endpoint (R15), então
// quem não é da coordenação nacional recebe 404 sem chamar o banco. O banco confere de novo e audita cada mudança.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCoordinationScreen } from "@/modules/houses";
import { createSkill, mergeSkills, moveSkill, renameSkill, renameSkillGroup, setSkillActive, type SkillResult } from "@/modules/skills";
import { log } from "@/server/log";

const CATALOG_PATH = "/coordenacao/habilidades/catalogo";

const text = (data: FormData, key: string): string => {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
};

export async function catalogAction(formData: FormData): Promise<void> {
  const { client } = await requireCoordinationScreen("skills");
  const action = text(formData, "acao");
  let result: SkillResult;
  switch (action) {
    case "criar":
      result = await createSkill(client, { name: text(formData, "nome"), category: text(formData, "grupo") });
      break;
    case "renomear":
      result = await renameSkill(client, { id: text(formData, "habilidade"), name: text(formData, "nome") });
      break;
    case "mover":
      result = await moveSkill(client, { id: text(formData, "habilidade"), category: text(formData, "grupo") });
      break;
    case "renomear-grupo":
      result = await renameSkillGroup(client, { from: text(formData, "grupo"), to: text(formData, "novo") });
      break;
    case "desativar":
    case "reativar":
      result = await setSkillActive(client, { id: text(formData, "habilidade"), active: action === "reativar" });
      break;
    case "mesclar":
      result = await mergeSkills(client, { from: text(formData, "habilidade"), to: text(formData, "destino") });
      break;
    default:
      redirect(`${CATALOG_PATH}?erro=invalid`);
  }
  if (!result.ok) {
    log.warn("skill_catalog_change_refused", { action, reason: result.error });
    redirect(`${CATALOG_PATH}?erro=${result.error}`);
  }
  revalidatePath(CATALOG_PATH);
  redirect(`${CATALOG_PATH}?feito=1`);
}
