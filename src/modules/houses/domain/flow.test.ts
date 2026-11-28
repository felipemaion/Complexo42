import { describe, expect, it } from "vitest";
import { changeHouseFlow, formatProgress, initialFlow, nextFlow, type FlowContext, type FlowEvent, type FlowState } from "./flow";

const ctx: FlowContext = { questionIds: ["q1", "q2", "q3"] };
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
      const marked = nextFlow(asking, { type: "answer", value: -3 }, ctx);
      expect(marked).toEqual({ step: { kind: "question", index: 0 }, answers: { q1: -3 } });
    });

    it("trocar o círculo troca a resposta", () => {
      const first = nextFlow(asking, { type: "answer", value: -3 }, ctx);
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

    it("o mapa das casas do resultado (#201) vai junto para a apresentação, para as zonas coloridas do gráfico", () => {
      const byPoles = { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" };
      const step = nextFlow(run(answerAll), { type: "result_recorded", houseId: "casa-x", chart, byPoles }, ctx).step;
      expect(step).toEqual({ kind: "presentation", houseId: "casa-x", method: "questionnaire", chart, byPoles });
    });

    it("respostas do servidor fora do envio não mudam nada", () => {
      const asking = run([]);
      expect(nextFlow(asking, { type: "result_recorded", houseId: "casa-x", chart }, ctx)).toBe(asking);
    });

    it("falha ao enviar volta à última pergunta, mantendo as respostas e guardando o motivo da recusa (#199)", () => {
      const submitting = run(answerAll);
      const failed = nextFlow(submitting, { type: "submit_failed", error: "failed" }, ctx);
      expect(failed).toEqual({ step: { kind: "question", index: 2 }, answers: { q1: -3, q2: 1, q3: 3 }, refusal: { error: "failed" } });
    });

    it("a recusa por limite guarda o tempo restante", () => {
      const failed = nextFlow(run(answerAll), { type: "submit_failed", error: "rate_limited", retryAfterSeconds: 1500 }, ctx);
      expect(failed.refusal).toEqual({ error: "rate_limited", retryAfterSeconds: 1500 });
    });

    it("a recusa some quando a pessoa age (muda a resposta, avança ou volta)", () => {
      const failed = nextFlow(run(answerAll), { type: "submit_failed", error: "failed" }, ctx);
      expect(nextFlow(failed, { type: "answer", value: -1 }, ctx).refusal).toBeUndefined();
      expect(nextFlow(failed, { type: "back" }, ctx).refusal).toBeUndefined();
      expect(nextFlow(failed, { type: "next" }, ctx).refusal).toBeUndefined();
    });

    it("durante o envio, voltar não faz nada", () => {
      const submitting = run(answerAll);
      expect(nextFlow(submitting, { type: "back" }, ctx)).toBe(submitting);
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
    expect(nextFlow(back, { type: "answer", value: 3 }, ctx).answers).toEqual({ q1: 3 });
  });

  it("voltar da casa sugerida volta à última pergunta; da casa escolhida, à lista", () => {
    const answered = nextFlow(run(answerAll), { type: "result_recorded", houseId: "casa-sugerida", chart }, ctx);
    expect(nextFlow(answered, { type: "back" }, ctx).step).toEqual({ kind: "question", index: 2 });
    const chosen = run([{ type: "consent_declined" }, { type: "activity_chosen", houseId: "x" }]);
    expect(nextFlow(chosen, { type: "back" }, ctx).step).toEqual({ kind: "activities" });
  });

  describe("escolher outra casa depois do questionário: comparar as casas (#240)", () => {
    const byPoles = { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" } as const;
    const answered = nextFlow(run(answerAll), { type: "result_recorded", houseId: "casa-a", chart, byPoles, compareToken: "tok" }, ctx);

    it("leva à comparação das casas, com a sugerida e as respostas guardadas (a comparação as usa no servidor)", () => {
      const compare = nextFlow(answered, { type: "choose_other" }, ctx);
      expect(compare.step).toEqual({ kind: "compare", suggestedId: "casa-a", chart, byPoles, compareToken: "tok" });
      // O token (selado pelo servidor ao pontuar) é o que a comparação usa: as respostas não vão de novo.
      expect(compare.answers).toEqual(answered.answers);
    });

    it("selecionar uma casa a destaca, sem confirmar", () => {
      const compare = nextFlow(answered, { type: "choose_other" }, ctx);
      const selected = nextFlow(compare, { type: "house_selected", houseId: "casa-c" }, ctx);
      expect(selected.step).toMatchObject({ kind: "compare", suggestedId: "casa-a", selectedId: "casa-c" });
      expect(nextFlow(selected, { type: "house_selected", houseId: "casa-d" }, ctx).step).toMatchObject({ selectedId: "casa-d" });
    });

    it("confirmar outra casa vai à apresentação (self) e descarta as respostas; confirmar a sugerida mantém questionnaire", () => {
      const selected = nextFlow(nextFlow(answered, { type: "choose_other" }, ctx), { type: "house_selected", houseId: "casa-c" }, ctx);
      expect(nextFlow(selected, { type: "house_confirmed" }, ctx)).toEqual({
        step: { kind: "presentation", houseId: "casa-c", method: "self" },
        answers: {},
      });
      const suggested = nextFlow(nextFlow(answered, { type: "choose_other" }, ctx), { type: "house_selected", houseId: "casa-a" }, ctx);
      expect(nextFlow(suggested, { type: "house_confirmed" }, ctx).step).toEqual({ kind: "presentation", houseId: "casa-a", method: "questionnaire", chart, byPoles, compareToken: "tok" });
    });

    it("sem casa selecionada, confirmar não faz nada; voltar leva à casa sugerida", () => {
      const compare = nextFlow(answered, { type: "choose_other" }, ctx);
      expect(nextFlow(compare, { type: "house_confirmed" }, ctx)).toBe(compare);
      expect(nextFlow(compare, { type: "back" }, ctx).step).toEqual({ kind: "presentation", houseId: "casa-a", method: "questionnaire", chart, byPoles, compareToken: "tok" });
    });
  });

  describe("trocar de casa depois da trava: a mesma comparação, com a casa atual (#268)", () => {
    const byPoles = { aa: "casa-a", ab: "casa-b", ba: "casa-c", bb: "casa-d" } as const;
    const start = changeHouseFlow({ currentId: "casa-a", suggestedId: "casa-b", chart: [...chart], byPoles, compareToken: "tok" });
    const compareStep = start.step as Extract<FlowState["step"], { kind: "compare" }>;

    it("começa direto na comparação, com a casa atual, a sugerida e o token do servidor (sem respostas no navegador)", () => {
      expect(start).toEqual({ step: { kind: "compare", currentId: "casa-a", suggestedId: "casa-b", chart, byPoles, compareToken: "tok" }, answers: {} });
    });

    it("sem resultado do questionário a comparação abre só com a casa atual", () => {
      expect(changeHouseFlow({ currentId: "casa-a" }).step).toEqual({ kind: "compare", currentId: "casa-a" });
    });

    it("confirmar a sugerida mantém a entrada pelo questionário; outra casa é escolha direta; ambas guardam a volta à comparação", () => {
      const selectedSuggested = nextFlow(start, { type: "house_selected", houseId: "casa-b" }, ctx);
      const toSuggested = nextFlow(selectedSuggested, { type: "house_confirmed" }, ctx);
      expect(toSuggested.step).toMatchObject({ kind: "presentation", houseId: "casa-b", method: "questionnaire" });
      expect(toSuggested.step).toMatchObject({ returnTo: { ...compareStep, selectedId: "casa-b" } });
      const toOther = nextFlow(nextFlow(start, { type: "house_selected", houseId: "casa-c" }, ctx), { type: "house_confirmed" }, ctx);
      expect(toOther.step).toMatchObject({ kind: "presentation", houseId: "casa-c", method: "self", returnTo: { selectedId: "casa-c" } });
    });

    it("a casa atual não se confirma (trocar para a mesma casa não existe)", () => {
      const current = nextFlow(start, { type: "house_selected", houseId: "casa-a" }, ctx);
      expect(nextFlow(current, { type: "house_confirmed" }, ctx)).toBe(current);
    });

    it("voltar da apresentação, ou escolher outra casa, volta à comparação com a casa que estava selecionada", () => {
      const presented = nextFlow(nextFlow(start, { type: "house_selected", houseId: "casa-c" }, ctx), { type: "house_confirmed" }, ctx);
      const expected = { kind: "compare", currentId: "casa-a", suggestedId: "casa-b", chart, byPoles, compareToken: "tok", selectedId: "casa-c" };
      expect(nextFlow(presented, { type: "back" }, ctx).step).toEqual(expected);
      expect(nextFlow(presented, { type: "choose_other" }, ctx).step).toEqual(expected);
    });

    it("voltar na própria comparação não faz nada no fluxo (a tela sai para a página da casa)", () => {
      expect(nextFlow(start, { type: "back" }, ctx)).toBe(start);
    });
  });

  it("escolher outra casa vindo da lista de atividades (sem questionário) segue como antes: lista, sem respostas", () => {
    const chosen = run([{ type: "consent_declined" }, { type: "activity_chosen", houseId: "x" }]);
    expect(nextFlow(chosen, { type: "choose_other" }, ctx)).toEqual({ step: { kind: "activities" }, answers: {} });
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
