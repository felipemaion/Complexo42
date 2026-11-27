import type { Answer, Answers } from "@/modules/questionnaire";

/*
 * Fluxo da escolha da casa (#76, ADR 0008 §2 e §2.1). Puro: a tela só despacha eventos.
 *
 *   ask ─ sim ─▶ activities ─ atividade ─▶ presentation (self)
 *    └─ não ─▶ consent ─ recusa ─▶ activities
 *                 └─ aceita ─▶ question 1..N ─ última ─▶ submit ─ casa ─▶ presentation (questionnaire)
 *                                                          └─ análise ─▶ analysis ─▶ activities
 *
 * As respostas vivem só neste estado, em memória (nunca no armazenamento do navegador). Ao fim
 * das perguntas vão ao servidor, que pontua (ADR 0014 §1) e devolve a casa ou o aviso de que o
 * pedido de análise foi aberto; o navegador não conhece a chave. "Escolher outra casa" leva à
 * lista de atividades, e a entrada vira `self`.
 */

export type JoinMethod = "self" | "questionnaire";

export type Step =
  | { kind: "ask" }
  | { kind: "activities" }
  | { kind: "consent" }
  | { kind: "question"; index: number }
  /** Depois da última pergunta: as respostas vão ao servidor, que pontua e grava o resultado. */
  | { kind: "submit" }
  /** Resultado inconclusivo: a coordenação nacional decide a casa. */
  | { kind: "analysis" }
  | { kind: "presentation"; houseId: string; method: JoinMethod };

export type FlowState = { step: Step; answers: Answers };

export type FlowEvent =
  | { type: "knows"; value: boolean }
  | { type: "consent_accepted" }
  | { type: "consent_declined" }
  | { type: "answer"; value: Answer }
  | { type: "result_recorded"; houseId: string }
  | { type: "analysis_requested" }
  | { type: "submit_failed" }
  | { type: "activity_chosen"; houseId: string }
  | { type: "choose_other" }
  | { type: "back" };

/** O que o fluxo precisa do questionário: a ordem dos itens (a pontuação é do servidor). */
export type FlowContext = {
  itemIds: readonly string[];
};

export const initialFlow: FlowState = { step: { kind: "ask" }, answers: {} };

function at(step: Step, answers: Answers): FlowState {
  return { step, answers };
}

/** Próximo estado. Evento que não cabe no passo atual não muda nada. */
export function nextFlow(state: FlowState, event: FlowEvent, ctx: FlowContext): FlowState {
  const { step, answers } = state;
  const last = ctx.itemIds.length - 1;

  if (event.type === "back") {
    switch (step.kind) {
      case "activities":
      case "consent":
        return at({ kind: "ask" }, answers);
      case "question":
        return at(step.index === 0 ? { kind: "consent" } : { kind: "question", index: step.index - 1 }, answers);
      case "analysis":
        return at({ kind: "question", index: last }, answers);
      case "presentation":
        return at(step.method === "questionnaire" ? { kind: "question", index: last } : { kind: "activities" }, answers);
      default:
        return state;
    }
  }

  switch (step.kind) {
    case "ask":
      if (event.type !== "knows") return state;
      return at(event.value ? { kind: "activities" } : { kind: "consent" }, answers);
    case "consent":
      if (event.type === "consent_declined") return at({ kind: "activities" }, {});
      if (event.type === "consent_accepted") return at({ kind: "question", index: 0 }, answers);
      return state;
    case "question": {
      if (event.type !== "answer") return state;
      const id = ctx.itemIds[step.index];
      if (id === undefined) return state;
      const next = { ...answers, [id]: event.value };
      if (step.index < last) return at({ kind: "question", index: step.index + 1 }, next);
      return at({ kind: "submit" }, next);
    }
    case "submit":
      return afterSubmit(state, event, last);
    case "activities":
      if (event.type !== "activity_chosen") return state;
      return at({ kind: "presentation", houseId: event.houseId, method: "self" }, answers);
    case "analysis":
    case "presentation":
      if (event.type !== "choose_other") return state;
      // Quem troca a sugestão não precisa mais das respostas: descarta.
      return at({ kind: "activities" }, {});
  }
}

/** O servidor respondeu ao envio das respostas: segue para a casa, a análise, ou volta à última pergunta. */
function afterSubmit(state: FlowState, event: FlowEvent, lastIndex: number): FlowState {
  const { answers } = state;
  if (event.type === "result_recorded") return at({ kind: "presentation", houseId: event.houseId, method: "questionnaire" }, answers);
  if (event.type === "analysis_requested") return at({ kind: "analysis" }, answers);
  if (event.type === "submit_failed") return at({ kind: "question", index: lastIndex }, answers);
  return state;
}

/** "3 de 26": troca `{current}` e `{total}` no texto da config. */
export function formatProgress(template: string, current: number, total: number): string {
  return template.replaceAll("{current}", String(current)).replaceAll("{total}", String(total));
}
