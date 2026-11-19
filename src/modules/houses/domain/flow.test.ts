import { describe, expect, it } from "vitest";
import type { Answers } from "@/modules/questionnaire";
import { formatProgress, initialFlow, nextFlow, type FlowContext, type FlowEvent, type FlowState } from "./flow";

const suggested: Answers[] = [];
const ctx: FlowContext = {
  itemIds: ["q1", "q2", "q3"],
  suggest: (answers) => {
    suggested.push(answers);
    return "casa-sugerida";
  },
};

function run(events: FlowEvent[], from: FlowState = initialFlow): FlowState {
  return events.reduce((state, event) => nextFlow(state, event, ctx), from);
}

describe("fluxo da escolha da casa", () => {
  it("sim → lista de atividades → apresentação da casa escolhida (self)", () => {
    expect(run([{ type: "knows", value: true }]).step).toEqual({ kind: "activities" });
    expect(run([{ type: "knows", value: true }, { type: "activity_chosen", houseId: "casa-b" }]).step).toEqual({
      kind: "presentation",
      houseId: "casa-b",
      method: "self",
    });
  });

  it("não → termo → uma pergunta por vez → casa sugerida (questionnaire)", () => {
    const events: FlowEvent[] = [{ type: "knows", value: false }];
    expect(run(events).step).toEqual({ kind: "consent" });
    events.push({ type: "consent_accepted" });
    expect(run(events).step).toEqual({ kind: "question", index: 0 });
    events.push({ type: "answer", value: "a" }, { type: "answer", value: "both" });
    expect(run(events).step).toEqual({ kind: "question", index: 2 });
    events.push({ type: "answer", value: "b" });
    const end = run(events);
    expect(end.step).toEqual({ kind: "presentation", houseId: "casa-sugerida", method: "questionnaire" });
    expect(suggested.at(-1)).toEqual({ q1: "a", q2: "both", q3: "b" });
  });

  it("recusar o termo leva à escolha direta, sem respostas", () => {
    const state = run([{ type: "knows", value: false }, { type: "consent_declined" }]);
    expect(state).toEqual({ step: { kind: "activities" }, answers: {} });
  });

  it("voltar: pergunta anterior mantendo a resposta; da 1ª, ao termo; do termo, à pergunta inicial", () => {
    const q2 = run([{ type: "knows", value: false }, { type: "consent_accepted" }, { type: "answer", value: "a" }]);
    const back = nextFlow(q2, { type: "back" }, ctx);
    expect(back).toEqual({ step: { kind: "question", index: 0 }, answers: { q1: "a" } });
    expect(nextFlow(back, { type: "back" }, ctx).step).toEqual({ kind: "consent" });
    expect(run([{ type: "back" }, { type: "back" }], back).step).toEqual({ kind: "ask" });
    // Responder de novo troca a resposta.
    expect(nextFlow(back, { type: "answer", value: "b" }, ctx).answers).toEqual({ q1: "b" });
  });

  it("voltar da casa sugerida volta à última pergunta; da casa escolhida, à lista", () => {
    const answered = run([
      { type: "knows", value: false },
      { type: "consent_accepted" },
      { type: "answer", value: "a" },
      { type: "answer", value: "a" },
      { type: "answer", value: "a" },
    ]);
    expect(nextFlow(answered, { type: "back" }, ctx).step).toEqual({ kind: "question", index: 2 });
    const chosen = run([{ type: "knows", value: true }, { type: "activity_chosen", houseId: "x" }]);
    expect(nextFlow(chosen, { type: "back" }, ctx).step).toEqual({ kind: "activities" });
  });

  it("escolher outra casa leva à lista e descarta as respostas", () => {
    const answered = run([
      { type: "knows", value: false },
      { type: "consent_accepted" },
      { type: "answer", value: "a" },
      { type: "answer", value: "b" },
      { type: "answer", value: "both" },
    ]);
    const other = nextFlow(answered, { type: "choose_other" }, ctx);
    expect(other).toEqual({ step: { kind: "activities" }, answers: {} });
    expect(nextFlow(other, { type: "activity_chosen", houseId: "casa-c" }, ctx).step).toEqual({
      kind: "presentation",
      houseId: "casa-c",
      method: "self",
    });
  });

  it("evento fora do passo não muda nada", () => {
    expect(nextFlow(initialFlow, { type: "answer", value: "a" }, ctx)).toBe(initialFlow);
    expect(nextFlow(initialFlow, { type: "back" }, ctx)).toBe(initialFlow);
    const activities = run([{ type: "knows", value: true }]);
    expect(nextFlow(activities, { type: "consent_accepted" }, ctx)).toBe(activities);
  });
});

describe("formatProgress", () => {
  it("monta o progresso a partir do texto da config", () => {
    expect(formatProgress("{current} de {total}", 3, 26)).toBe("3 de 26");
    expect(formatProgress("Pergunta {current}/{total}", 1, 10)).toBe("Pergunta 1/10");
  });
});
