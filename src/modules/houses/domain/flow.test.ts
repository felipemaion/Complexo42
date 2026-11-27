import { describe, expect, it } from "vitest";
import { formatProgress, initialFlow, nextFlow, type FlowContext, type FlowEvent, type FlowState } from "./flow";

const ctx: FlowContext = { itemIds: ["q1", "q2", "q3"] };
const chart = [{ key: "house1", label: "D1", poleA: "a1", poleB: "b1", score: -40 }] as const;
const answerAll: FlowEvent[] = [
  { type: "consent_accepted" },
  { type: "answer", value: -3 },
  { type: "next" },
  { type: "answer", value: 1 },
  { type: "next" },
  { type: "answer", value: 3 },
  { type: "next" },
];

function run(events: FlowEvent[], from: FlowState = initialFlow): FlowState {
  return events.reduce((state, event) => nextFlow(state, event, ctx), from);
}

describe("fluxo da escolha da casa", () => {
  it("começa direto no termo do questionário: não há pergunta inicial (#193)", () => {
    expect(initialFlow).toEqual({ step: { kind: "consent" }, answers: {} });
  });

  it("recusar o termo → lista de atividades → apresentação da casa escolhida (self)", () => {
    expect(run([{ type: "consent_declined" }]).step).toEqual({ kind: "activities" });
    expect(run([{ type: "consent_declined" }, { type: "activity_chosen", houseId: "casa-b" }]).step).toEqual({
      kind: "presentation",
      houseId: "casa-b",
      method: "self",
    });
  });

  it("termo aceito → uma pergunta por vez → casa sugerida (questionnaire)", () => {
    const events: FlowEvent[] = [];
    expect(run(events).step).toEqual({ kind: "consent" });
    events.push({ type: "consent_accepted" });
    expect(run(events).step).toEqual({ kind: "question", index: 0 });
    events.push({ type: "answer", value: -3 }, { type: "next" }, { type: "answer", value: 1 }, { type: "next" });
    expect(run(events).step).toEqual({ kind: "question", index: 2 });
    events.push({ type: "answer", value: 3 }, { type: "next" });
    const end = run(events);
    expect(end.step).toEqual({ kind: "submit" });
    expect(end.answers).toEqual({ q1: -3, q2: 1, q3: 3 });
    expect(nextFlow(end, { type: "result_recorded", houseId: "casa-sugerida", chart }, ctx).step).toEqual({
      kind: "presentation",
      houseId: "casa-sugerida",
      method: "questionnaire",
      chart,
    });
  });

  describe("a escala de intensidade (#183)", () => {
    const asking = run([{ type: "consent_accepted" }]);

    it("nenhum círculo vem marcado: a pergunta começa sem resposta", () => {
      expect(asking.answers).toEqual({});
    });

    it("resposta obrigatória: sem marcar, \"próxima\" não avança", () => {
      expect(nextFlow(asking, { type: "next" }, ctx)).toBe(asking);
    });

    it("marcar um círculo guarda a intensidade e fica na mesma pergunta", () => {
      const marked = nextFlow(asking, { type: "answer", value: -2 }, ctx);
      expect(marked).toEqual({ step: { kind: "question", index: 0 }, answers: { q1: -2 } });
    });

    it("trocar o círculo troca a resposta", () => {
      const first = nextFlow(asking, { type: "answer", value: -2 }, ctx);
      expect(nextFlow(first, { type: "answer", value: 3 }, ctx).answers).toEqual({ q1: 3 });
    });

    it("com a resposta marcada, \"próxima\" segue para a pergunta seguinte, sem marcar nada nela", () => {
      const marked = nextFlow(asking, { type: "answer", value: 1 }, ctx);
      const second = nextFlow(marked, { type: "next" }, ctx);
      expect(second.step).toEqual({ kind: "question", index: 1 });
      expect(second.answers).toEqual({ q1: 1 });
      expect(nextFlow(second, { type: "next" }, ctx)).toBe(second);
    });

    it("a última pergunta respondida leva ao envio", () => {
      expect(run(answerAll).step).toEqual({ kind: "submit" });
    });
  });

  describe("depois da última pergunta (ADR 0014)", () => {
    it("o servidor devolve a casa: segue para a apresentação da casa sugerida", () => {
      const submitting = run(answerAll);
      expect(nextFlow(submitting, { type: "result_recorded", houseId: "casa-x", chart }, ctx).step).toEqual({
        kind: "presentation",
        houseId: "casa-x",
        method: "questionnaire",
        chart,
      });
    });

    it("o servidor abriu o pedido de análise: segue para a análise, sem casa atribuída", () => {
      const submitting = run(answerAll);
      expect(nextFlow(submitting, { type: "analysis_requested" }, ctx).step).toEqual({ kind: "analysis" });
    });

    it("respostas do servidor fora do envio não mudam nada", () => {
      const asking = run([]);
      expect(nextFlow(asking, { type: "result_recorded", houseId: "casa-x", chart }, ctx)).toBe(asking);
      expect(nextFlow(asking, { type: "analysis_requested" }, ctx)).toBe(asking);
    });

    it("falha ao enviar volta à última pergunta, mantendo as respostas", () => {
      const submitting = run(answerAll);
      const failed = nextFlow(submitting, { type: "submit_failed" }, ctx);
      expect(failed).toEqual({ step: { kind: "question", index: 2 }, answers: { q1: -3, q2: 1, q3: 3 } });
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

  it("da lista de atividades, voltar leva ao termo (de onde se pode aceitar e responder)", () => {
    const activities = run([{ type: "consent_declined" }]);
    expect(nextFlow(activities, { type: "back" }, ctx).step).toEqual({ kind: "consent" });
  });

  it("recusar o termo leva à escolha direta, sem respostas", () => {
    const state = run([{ type: "consent_declined" }]);
    expect(state).toEqual({ step: { kind: "activities" }, answers: {} });
  });

  it("voltar: pergunta anterior mantendo a resposta; da 1ª, ao termo; o termo é o começo (não há para onde voltar)", () => {
    const q2 = run([{ type: "consent_accepted" }, { type: "answer", value: -3 }, { type: "next" }]);
    const back = nextFlow(q2, { type: "back" }, ctx);
    expect(back).toEqual({ step: { kind: "question", index: 0 }, answers: { q1: -3 } });
    expect(nextFlow(back, { type: "back" }, ctx).step).toEqual({ kind: "consent" });
    const atTerm = nextFlow(back, { type: "back" }, ctx);
    expect(nextFlow(atTerm, { type: "back" }, ctx)).toBe(atTerm);
    // Responder de novo troca a resposta.
    expect(nextFlow(back, { type: "answer", value: 2 }, ctx).answers).toEqual({ q1: 2 });
  });

  it("voltar da casa sugerida volta à última pergunta; da casa escolhida, à lista", () => {
    const answered = nextFlow(run(answerAll), { type: "result_recorded", houseId: "casa-sugerida", chart }, ctx);
    expect(nextFlow(answered, { type: "back" }, ctx).step).toEqual({ kind: "question", index: 2 });
    const chosen = run([{ type: "consent_declined" }, { type: "activity_chosen", houseId: "x" }]);
    expect(nextFlow(chosen, { type: "back" }, ctx).step).toEqual({ kind: "activities" });
  });

  it("escolher outra casa leva à lista e descarta as respostas", () => {
    const answered = nextFlow(run(answerAll), { type: "result_recorded", houseId: "casa-sugerida", chart }, ctx);
    const other = nextFlow(answered, { type: "choose_other" }, ctx);
    expect(other).toEqual({ step: { kind: "activities" }, answers: {} });
    expect(nextFlow(other, { type: "activity_chosen", houseId: "casa-c" }, ctx).step).toEqual({
      kind: "presentation",
      houseId: "casa-c",
      method: "self",
    });
  });

  it("evento fora do passo não muda nada", () => {
    expect(nextFlow(initialFlow, { type: "answer", value: -1 }, ctx)).toBe(initialFlow);
    expect(nextFlow(initialFlow, { type: "next" }, ctx)).toBe(initialFlow);
    expect(nextFlow(initialFlow, { type: "back" }, ctx)).toBe(initialFlow);
    const activities = run([{ type: "consent_declined" }]);
    expect(nextFlow(activities, { type: "consent_accepted" }, ctx)).toBe(activities);
  });
});

describe("formatProgress", () => {
  it("monta o progresso a partir do texto da config", () => {
    expect(formatProgress("{current} de {total}", 3, 26)).toBe("3 de 26");
    expect(formatProgress("Pergunta {current}/{total}", 1, 10)).toBe("Pergunta 1/10");
  });
});
