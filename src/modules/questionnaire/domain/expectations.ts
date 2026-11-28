import type { Answer, Answers, AxisScores } from "./score";
import type { QuestionnaireConfig } from "./schema";

/*
 * O que se espera numa casa (tela "Escolher outra casa"). Puro: sem I/O. Roda só no servidor: a chave (qual polo de qual
 * eixo é de qual casa) e as frases de expectativa nunca vão ao navegador, só o resultado para a casa selecionada.
 */

export type HouseExpectation = {
  itemId: string;
  /** Frase de expectativa do polo da casa (config privada). Nunca escrita no código. */
  text: string;
  /** A resposta da pessoa (-5..5, sem 0): -5/5 é "Totalmente", 3 "Na maior parte das vezes", -1/1 "Um pouco mais". */
  answer: Answer;
};

/** Polos da casa nos eixos 1 e 2, pelo mapa `houseByPoles` ("ab" = polo a no eixo 1 e b no eixo 2). */
function polesOf(config: QuestionnaireConfig, houseId: string): readonly ["a" | "b", "a" | "b"] | null {
  const key = (Object.keys(config.houseByPoles) as (keyof typeof config.houseByPoles)[]).find((k) => config.houseByPoles[k] === houseId);
  return key ? ([key[0], key[1]] as ["a" | "b", "a" | "b"]) : null;
}

/**
 * Só os itens dos eixos da casa (nunca o totem) em que a resposta foi para o OUTRO polo que o da casa, com a frase do polo da
 * casa, da contradição mais forte para a mais fraca (empate: ordem das perguntas). Item sem frase na config não entra:
 * nada de frase inventada.
 */
export function houseExpectations(config: QuestionnaireConfig, answers: Answers, houseId: string): HouseExpectation[] {
  const poles = polesOf(config, houseId);
  if (!poles) return [];
  const order = new Map(config.items.map((item, index) => [item.id, index]));
  const found: HouseExpectation[] = [];
  (["house1", "house2"] as const).forEach((axis, axisIndex) => {
    const pole = poles[axisIndex]!;
    for (const id of config.axes[axis].itemIds) {
      const answer = answers[id];
      const phrase = config.items.find((item) => item.id === id)?.expectation?.[pole];
      if (answer === undefined || phrase === undefined) continue;
      const given = answer < 0 ? "a" : "b";
      if (given !== pole) found.push({ itemId: id, text: phrase, answer });
    }
  });
  return found.sort((x, y) => Math.abs(y.answer) - Math.abs(x.answer) || (order.get(x.itemId) ?? 0) - (order.get(y.itemId) ?? 0));
}

/** Itens dos eixos da casa sem a frase de expectativa dos dois polos (a config precisa de todos; o totem não). */
export function missingExpectations(config: QuestionnaireConfig): string[] {
  const missing = new Set<string>();
  for (const axis of ["house1", "house2"] as const) {
    for (const id of config.axes[axis].itemIds) {
      const e = config.items.find((item) => item.id === id)?.expectation;
      if (!e || !e.a || !e.b) missing.add(id);
    }
  }
  const order = new Map(config.items.map((item, index) => [item.id, index]));
  return [...missing].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
}

export type AxisExpectation = { axis: "house1" | "house2"; text: string; answer: Answer };

/** Força da nota do eixo (-100..100) na escala 1-3-5 das respostas, com o sinal do lado (negativo = polo a). */
function intensityOf(score: number): Answer {
  const strength = Math.abs(score) < 34 ? 1 : Math.abs(score) < 67 ? 3 : 5;
  return (score < 0 ? -strength : strength) as Answer;
}

/**
 * Sem respostas guardadas (quem respondeu antes de #256): a frase geral de cada EIXO da casa em que a nota da pessoa está do
 * lado oposto ao da casa, da nota mais forte para a mais leve (empate: eixo 1 antes do 2). Só os eixos da casa; o totem nunca
 * entra. Eixo sem frase na config não entra: nada de frase inventada.
 */
export function axisExpectations(config: QuestionnaireConfig, scores: Pick<AxisScores, "house1" | "house2"> & Record<string, unknown>, houseId: string): AxisExpectation[] {
  const poles = polesOf(config, houseId);
  if (!poles) return [];
  const found: AxisExpectation[] = [];
  (["house1", "house2"] as const).forEach((axis, axisIndex) => {
    const pole = poles[axisIndex]!;
    const score = scores[axis];
    const phrase = config.axes[axis].expectation?.[pole];
    if (score === 0 || phrase === undefined) return;
    if ((score < 0 ? "a" : "b") !== pole) found.push({ axis, text: phrase, answer: intensityOf(score) });
  });
  return found.sort((x, y) => Math.abs(y.answer) - Math.abs(x.answer) || Math.abs(scores[y.axis]) - Math.abs(scores[x.axis]));
}
