"use server";
// Server action de "Liberar" / "Bloquear" na fila de espera (#26, ADR 0008 §1). Só composição:
// sessão (JWT, R14) + `decideAccess`, que chama `decide_access`. Quem pode decidir é o banco
// (`app.can_decide_access`, R15): fora do escopo, pessoa já decidida ou inexistente dão o
// mesmo 42501, e a tela mostra a mesma mensagem nos três casos (sem oráculo).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  AccessError,
  DECISION_FIELD,
  DECISION_PROFILE_FIELD,
  WAITLIST_PARAMS,
  WAITLIST_QUEUE_PATH,
  decideAccess,
  decisionOf,
  parseDecisionWord,
  waitlistHref,
  type WaitlistDoneStatus,
} from "@/modules/access";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

async function decide(formData: FormData): Promise<WaitlistDoneStatus> {
  const { client } = await requireUserClient();
  const profileId = z.guid().safeParse(formData.get(DECISION_PROFILE_FIELD));
  const word = parseDecisionWord(formData.get(DECISION_FIELD));
  if (!profileId.success || !word) return "erro";
  try {
    const decided = await decideAccess(client, profileId.data, decisionOf(word));
    return decided === "active" ? "liberado" : "bloqueado";
  } catch (err) {
    if (err instanceof AccessError && err.code === "forbidden") return "indisponivel";
    log.error("access_decision_failed", { reason: err instanceof AccessError ? err.code : "unknown" });
    return "erro";
  }
}

export async function decideAccessAction(formData: FormData): Promise<void> {
  const done = await decide(formData);
  revalidatePath(WAITLIST_QUEUE_PATH);
  // Volta ao começo da fila: a pessoa decidida sai da lista.
  redirect(waitlistHref(undefined, { [WAITLIST_PARAMS.done]: done }));
}
