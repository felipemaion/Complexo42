import type { Answer, Answers, ChartAxis, HouseByPoles } from "@/modules/questionnaire";
import type { Refusal } from "./refusal";

/*
 * Fluxo da escolha da casa (#76, ADR 0008 §2 e §2.1). Puro: a tela só despacha eventos.
 *
 *   consent ─ recusa ─▶ activities ─ atividade ─▶ presentation (self)
 *      └─ aceita ─▶ question 1..N ─ última ─▶ submit ─ casa ─▶ presentation (questionnaire)
 *                              (marcar um círculo e "próxima": resposta obrigatória, nenhuma de início)
 *
 * As respostas vivem só neste estado, em memória (nunca no armazenamento do navegador). Ao fim
 * das perguntas vão ao servidor, que pontua (ADR 0014 §1) e devolve a casa; o navegador não conhece a chave. "Escolher outra casa" leva à
 * lista de atividades, e a entrada vira `self`.
 */

export type JoinMethod = "self" | "questionnaire";

export type Step =
  | { kind: "activities" }
  /** O começo (#193): o termo do questionário; quem o recusa escolhe a casa direto. */
  | { kind: "consent" }
  | { kind: "question"; index: number }
  /** Depois da última pergunta: as respostas vão ao servidor, que pontua e grava o resultado. */
  | { kind: "submit" }
  /**
   * `chart`: o perfil da pessoa (só os eixos da casa), quando a casa veio do questionário;
   * `byPoles`: o mapa das casas para as zonas coloridas do gráfico (#201).
   */
  | { kind: "presentation"; houseId: string; method: JoinMethod; chart?: readonly ChartAxis[]; byPoles?: HouseByPoles; compareToken?: string; returnTo?: CompareStep }
  /**
   * "Escolher outra casa" depois do questionário (#240): as quatro casas, a sugerida em destaque; `selectedId` é a casa que a
   * pessoa está comparando (ainda sem confirmar). As respostas ficam no estado: a comparação (o que se espera, o perfil
   * médio) é calculada no servidor, que tem a chave.
   */
  | CompareStep;

/**
 * `currentId`: só na troca de casa depois da trava (#268): a casa em que a pessoa está, em destaque e sem poder ser confirmada.
 * Nessa troca o fluxo começa aqui (`changeHouseFlow`), `suggestedId` e o resto vêm do resultado guardado (podem faltar) e o
 * token é montado no servidor a partir do guardado.
 */
export type CompareStep = {
  kind: "compare";
  suggestedId?: string;
  currentId?: string;
  selectedId?: string;
  chart?: readonly ChartAxis[];
  byPoles?: HouseByPoles;
  compareToken?: string;
};

/** Começo da troca de casa depois da trava (#268): direto na comparação, sem respostas no navegador. */
export function changeHouseFlow(start: { currentId: string; suggestedId?: string; chart?: readonly ChartAxis[]; byPoles?: HouseByPoles; compareToken?: string }): FlowState {
  const { currentId, suggestedId, chart, byPoles, compareToken } = start;
  return at({ kind: "compare", currentId, ...(suggestedId && { suggestedId }), ...(chart && { chart }), ...(byPoles && { byPoles }), ...(compareToken && { compareToken }) }, {});
}

/** `refusal`: por que o último envio das respostas foi recusado; some na próxima ação da pessoa (#199). */
export type FlowState = { step: Step; answers: Answers; refusal?: Refusal };

export type FlowEvent =
  | { type: "consent_accepted" }
  | { type: "consent_declined" }
  /** Marca a intensidade da pergunta atual; só `next` avança. */
  | { type: "answer"; value: Answer }
  | { type: "next" }
  /** `compareToken`: as respostas seladas pelo servidor (cifradas para a pessoa), para a comparação de casas. */
  | { type: "result_recorded"; houseId: string; chart: readonly ChartAxis[]; byPoles?: HouseByPoles; compareToken?: string }
  /** O servidor recusou o envio; `error` (e o tempo restante, no limite) aparece na tela. */
  | ({ type: "submit_failed" } & Refusal)
  | { type: "activity_chosen"; houseId: string }
  | { type: "choose_other" }
  /** Na comparação: seleciona (só destaca) uma das casas. */
  | { type: "house_selected"; houseId: string }
  /** Na comparação: confirma a casa selecionada (segue para a apresentação, onde se aceita). */
  | { type: "house_confirmed" }
  | { type: "back" };

/** O que o fluxo precisa do questionário: a ordem dos itens (a pontuação é do servidor). */
export type FlowContext = {
  questionIds: readonly string[];
};

export const initialFlow: FlowState = { step: { kind: "consent" }, answers: {} };

function at(step: Step, answers: Answers): FlowState {
  return { step, answers };
}

/** Próximo estado. Evento que não cabe no passo atual não muda nada. */
export function nextFlow(state: FlowState, event: FlowEvent, ctx: FlowContext): FlowState {
  const { step, answers } = state;
  const last = ctx.questionIds.length - 1;

  if (event.type === "back") {
    switch (step.kind) {
      case "activities":
        return at({ kind: "consent" }, answers);
      case "question":
        return at(step.index === 0 ? { kind: "consent" } : { kind: "question", index: step.index - 1 }, answers);
      case "compare":
        // Na troca de casa (#268) não há apresentação para onde voltar: a tela sai para a página da casa.
        if (step.currentId !== undefined || step.suggestedId === undefined) return state;
        return at({ kind: "presentation", houseId: step.suggestedId, method: "questionnaire", ...(step.chart && { chart: step.chart }), ...(step.byPoles && { byPoles: step.byPoles }), ...(step.compareToken && { compareToken: step.compareToken }) }, answers);
      case "presentation":
        if (step.returnTo) return at(step.returnTo, answers);
        return at(step.method === "questionnaire" ? { kind: "question", index: last } : { kind: "activities" }, answers);
      default:
        return state;
    }
  }

  switch (step.kind) {
    case "consent":
      if (event.type === "consent_declined") return at({ kind: "activities" }, {});
      if (event.type === "consent_accepted") return at({ kind: "question", index: 0 }, answers);
      return state;
    case "question": {
      const id = ctx.questionIds[step.index];
      if (id === undefined) return state;
      if (event.type === "answer") return at(step, { ...answers, [id]: event.value });
      // Resposta obrigatória: sem círculo marcado, "próxima" não faz nada.
      if (event.type !== "next" || answers[id] === undefined) return state;
      return step.index < last ? at({ kind: "question", index: step.index + 1 }, answers) : at({ kind: "submit" }, answers);
    }
    case "submit":
      return afterSubmit(state, event, last);
    case "activities":
      if (event.type !== "activity_chosen") return state;
      return at({ kind: "presentation", houseId: event.houseId, method: "self" }, answers);
    case "presentation":
      if (event.type !== "choose_other") return state;
      if (step.returnTo) return at(step.returnTo, answers);
      // Depois do questionário, escolher outra casa abre a comparação (as respostas ficam para ela); vindo da lista, volta à lista.
      if (step.method === "questionnaire") {
        return at({ kind: "compare", suggestedId: step.houseId, ...(step.chart && { chart: step.chart }), ...(step.byPoles && { byPoles: step.byPoles }), ...(step.compareToken && { compareToken: step.compareToken }) }, answers);
      }
      // Quem troca a sugestão não precisa mais das respostas: descarta.
      return at({ kind: "activities" }, {});
    case "compare":
      if (event.type === "house_selected") return at({ ...step, selectedId: event.houseId }, answers);
      if (event.type !== "house_confirmed" || step.selectedId === undefined || step.selectedId === step.currentId) return state;
      // Na troca de casa (#268) a apresentação guarda a volta à comparação (com a casa selecionada).
      if (step.currentId !== undefined) {
        const isSuggested = step.selectedId === step.suggestedId;
        return at({ kind: "presentation", houseId: step.selectedId, method: isSuggested ? "questionnaire" : "self", ...(isSuggested && step.chart && { chart: step.chart }), ...(isSuggested && step.byPoles && { byPoles: step.byPoles }), ...(isSuggested && step.compareToken && { compareToken: step.compareToken }), returnTo: step }, answers);
      }
      // Confirmar a própria casa sugerida mantém a entrada pelo questionário; outra casa é escolha direta (self).
      if (step.selectedId === step.suggestedId) {
        return at({ kind: "presentation", houseId: step.selectedId, method: "questionnaire", ...(step.chart && { chart: step.chart }), ...(step.byPoles && { byPoles: step.byPoles }), ...(step.compareToken && { compareToken: step.compareToken }) }, answers);
      }
      return at({ kind: "presentation", houseId: step.selectedId, method: "self" }, {});
  }
}

/** O servidor respondeu ao envio das respostas: segue para a casa ou volta à última pergunta. */
function afterSubmit(state: FlowState, event: FlowEvent, lastIndex: number): FlowState {
  const { answers } = state;
  if (event.type === "result_recorded") {
    const { houseId, chart, byPoles, compareToken } = event;
    return at({ kind: "presentation", houseId, method: "questionnaire", chart, ...(byPoles && { byPoles }), ...(compareToken && { compareToken }) }, answers);
  }
  if (event.type === "submit_failed") {
    const { error, retryAfterSeconds } = event;
    const refusal: Refusal = retryAfterSeconds === undefined ? { error } : { error, retryAfterSeconds };
    return { step: { kind: "question", index: lastIndex }, answers, refusal };
  }
  return state;
}

/** "3 de 26": troca `{current}` e `{total}` no texto da config. */
export function formatProgress(template: string, current: number, total: number): string {
  return template.replaceAll("{current}", String(current)).replaceAll("{total}", String(total));
}
