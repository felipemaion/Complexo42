"use server";
// Decidir as sugestões de habilidade (#15). O guard da tela vale aqui também: a ação é um endpoint (R15), então
// quem não é da coordenação nacional recebe 404 sem chamar o banco. O banco confere de novo e audita a decisão.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCoordinationScreen } from "@/modules/houses";
import { decideSuggestion } from "@/modules/skills";
import { log } from "@/server/log";

const QUEUE_PATH = "/coordenacao/habilidades";

export async function decideSuggestionAction(formData: FormData): Promise<void> {
  const { client } = await requireCoordinationScreen("skills");
  const decision = formData.get("decisao");
  if (decision !== "aprovar" && decision !== "rejeitar") redirect(`${QUEUE_PATH}?erro=invalid`);
  const result = await decideSuggestion(
    client,
    decision === "aprovar"
      ? { suggestionId: formData.get("sugestao"), approve: true, category: formData.get("grupo") }
      : { suggestionId: formData.get("sugestao"), approve: false },
  );
  if (!result.ok) {
    log.warn("skill_suggestion_decision_refused", { reason: result.error });
    redirect(`${QUEUE_PATH}?erro=${result.error}`);
  }
  revalidatePath(QUEUE_PATH);
  redirect(`${QUEUE_PATH}?decidida=1`);
}
