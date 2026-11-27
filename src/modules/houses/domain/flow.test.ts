import { describe, expect, it } from "vitest";
import { formatProgress, initialFlow, nextFlow, type FlowContext, type FlowEvent, type FlowState } from "./flow";

const ctx: FlowContext = { itemIds: ["q1", "q2", "q3"] };
const answerAll: FlowEvent[] = [
  { type: "knows", value: false },
  { type: "consent_accepted" },
  { type: "answer", value: "a" },
  { type: "answer", value: "both" },
  { type: "answer", value: "b" },
];

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
    expect(end.step).toEqual({ kind: "submit" });
    expect(end.answers).toEqual({ q1: "a", q2: "both", q3: "b" });
    expect(nextFlow(end, { type: "result_recorded", houseId: "casa-sugerida" }, ctx).step).toEqual({
      kind: "presentation",
      houseId: "casa-sugerida",
      method: "questionnaire",
    });
  });

  describe("depois da última pergunta (ADR 0014)", () => {
    it("o servidor devolve a casa: segue para a apresentação da casa sugerida", () => {
      const submitting = run(answerAll);
      expect(nextFlow(submitting, { type: "result_recorded", houseId: "casa-x" }, ctx).step).toEqual({
        kind: "presentation",
        houseId: "casa-x",
        method: "questionnaire",
      });
    });

    it("o servidor abriu o pedido de análise: segue para a análise, sem casa atribuída", () => {
      const submitting = run(answerAll);
      expect(nextFlow(submitting, { type: "analysis_requested" }, ctx).step).toEqual({ kind: "analysis" });
    });

    it("respostas do servidor fora do envio não mudam nada", () => {
      const asking = run([{ type: "knows", value: false }]);
      expect(nextFlow(asking, { type: "result_recorded", houseId: "casa-x" }, ctx)).toBe(asking);
      expect(nextFlow(asking, { type: "analysis_requested" }, ctx)).toBe(asking);
    });

    it("falha ao enviar volta à última pergunta, mantendo as respostas", () => {
      const submitting = run(answerAll);
      const failed = nextFlow(submitting, { type: "submit_failed" }, ctx);
      expect(failed).toEqual({ step: { kind: "question", index: 2 }, answers: { q1: "a", q2: "both", q3: "b" } });
    });

    it("durante o envio, voltar não faz nada", () => {
      const submitting = run(answerAll);
      expect(nextFlow(submitting, { type: "back" }, ctx)).toBe(submitting);
    });

    it("da análise, voltar leva à última pergunta; escolher a casa direto descarta as respostas", () => {
      const analysis = nextFlow(run(answerAll), { type: "analysis_requested" }, ctx);
      expect(nextFlow(analysis, { type: "back" }, ctx).step).toEqual({ kind: "question", index: 2 });
      expect(nextFlow(analysis, { type: "choose_other" }, ctx)).toEqual({ step: { kind: "activities" }, answers: {} });
    });
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
    const answered = nextFlow(run(answerAll), { type: "result_recorded", houseId: "casa-sugerida" }, ctx);
    expect(nextFlow(answered, { type: "back" }, ctx).step).toEqual({ kind: "question", index: 2 });
    const chosen = run([{ type: "knows", value: true }, { type: "activity_chosen", houseId: "x" }]);
    expect(nextFlow(chosen, { type: "back" }, ctx).step).toEqual({ kind: "activities" });
  });

  it("escolher outra casa leva à lista e descarta as respostas", () => {
    const answered = nextFlow(run(answerAll), { type: "result_recorded", houseId: "casa-sugerida" }, ctx);
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
