import type { Axis, Pole, QuestionnaireConfig } from "./schema";

/*
 * Pontuação do questionário (ADR 0014, #172 e #183). Função pura: sem I/O, sem data, sem estado.
 * Roda só no servidor (ADR 0014 §1): o navegador não recebe a chave. As respostas só são
 * guardadas no caso inconclusivo, para o pedido de análise (ADR 0014 §3); as notas por eixo
 * ficam guardadas, cifradas, junto do resultado.
 */

/**
 * Intensidade da resposta, seis níveis e sem meio: negativo é o polo "a" (-3 muito a), positivo
 * é o polo "b" (3 muito b).
 */
export const answerValues = [-3, -2, -1, 1, 2, 3] as const;
export type Answer = (typeof answerValues)[number];
export type Answers = Readonly<Record<string, Answer>>;

/** Maior intensidade possível de uma resposta (a nota do eixo é normalizada por ela). */
const maxIntensity = 3;

/** Nota de cada eixo, inteira de -100 (tudo "muito a") a 100 (tudo "muito b"). */
export type AxisScores = Readonly<Record<Axis, number>>;

/**
 * Conclusivo: a casa sugerida, o totem e as notas. Inconclusivo: algum eixo sem polo (nota 0 e
 * desempate também 0); `axes` lista os eixos empatados e `scores` as notas, sem as respostas.
 */
export type QuestionnaireResult =
  | { status: "ok"; houseId: string; totem: string; scores: AxisScores }
  | { status: "inconclusive"; axes: readonly Axis[]; scores: AxisScores };

export type AnswerErrorCode = "missing_answer" | "unknown_item" | "invalid_answer";

/** Respostas incompletas ou inválidas. A mensagem cita só os ids dos itens. */
export class QuestionnaireAnswerError extends Error {
  constructor(
    readonly code: AnswerErrorCode,
    readonly itemIds: string[],
  ) {
    const reason = {
      missing_answer: "item sem resposta",
      unknown_item: "resposta para item inexistente",
      invalid_answer: "resposta fora de -3, -2, -1, 1, 2 e 3",
    }[code];
    super(`Respostas inválidas (${reason}): ${itemIds.join(", ")}`);
    this.name = "QuestionnaireAnswerError";
  }
}

const validValues: readonly unknown[] = answerValues;

function checkAnswers(config: QuestionnaireConfig, answers: Answers): void {
  const ids = new Set(config.items.map((item) => item.id));
  const unknown = Object.keys(answers).filter((id) => !ids.has(id));
  if (unknown.length > 0) throw new QuestionnaireAnswerError("unknown_item", unknown);
  const missing = config.items.filter((item) => !Object.hasOwn(answers, item.id)).map((item) => item.id);
  if (missing.length > 0) throw new QuestionnaireAnswerError("missing_answer", missing);
  const invalid = config.items.filter((item) => !validValues.includes(answers[item.id])).map((item) => item.id);
  if (invalid.length > 0) throw new QuestionnaireAnswerError("invalid_answer", invalid);
}

function sumOf(itemIds: readonly string[], answers: Answers): number {
  return itemIds.reduce((total, id) => total + (answers[id] as number), 0);
}

/** Nota do eixo: média das respostas, normalizada para -100..100 (inteira; sem -0). */
function scoreOf(itemIds: readonly string[], answers: Answers): number {
  return Math.round((sumOf(itemIds, answers) / itemIds.length / maxIntensity) * 100) + 0;
}

/** Polo de um conjunto de itens pelo sinal da soma (a média tem o mesmo sinal); soma 0 é empate. */
function poleOfSum(itemIds: readonly string[], answers: Answers): Pole | null {
  const sum = sumOf(itemIds, answers);
  if (sum === 0) return null;
  return sum < 0 ? "a" : "b";
}

/** Polo do eixo; em empate, desempata pela média dos itens indicados; ainda 0, `null`. */
function poleOf(config: QuestionnaireConfig, axis: Axis, answers: Answers): Pole | null {
  const { itemIds, tieBreakItems } = config.axes[axis];
  return poleOfSum(itemIds, answers) ?? (tieBreakItems.length > 0 ? poleOfSum(tieBreakItems, answers) : null);
}

/**
 * Transforma as respostas na casa sugerida, no totem e nas notas dos eixos. A casa é a
 * interseção dos polos dos eixos 1 e 2; o totem, as letras dos polos dos eixos 3 e 4. Se algum
 * eixo fica sem polo (nota 0 sem desempate), o resultado é inconclusivo: nenhuma casa é atribuída
 * (ADR 0014 §2).
 */
export function scoreQuestionnaire(config: QuestionnaireConfig, answers: Answers): QuestionnaireResult {
  checkAnswers(config, answers);
  const scores: AxisScores = {
    house1: scoreOf(config.axes.house1.itemIds, answers),
    house2: scoreOf(config.axes.house2.itemIds, answers),
    totem1: scoreOf(config.axes.totem1.itemIds, answers),
    totem2: scoreOf(config.axes.totem2.itemIds, answers),
  };
  const poles = {
    house1: poleOf(config, "house1", answers),
    house2: poleOf(config, "house2", answers),
    totem1: poleOf(config, "totem1", answers),
    totem2: poleOf(config, "totem2", answers),
  };
  const tied = (Object.keys(poles) as Axis[]).filter((axis) => poles[axis] === null);
  if (poles.house1 === null || poles.house2 === null || poles.totem1 === null || poles.totem2 === null) {
    return { status: "inconclusive", axes: tied, scores };
  }
  return {
    status: "ok",
    houseId: config.houseByPoles[`${poles.house1}${poles.house2}`],
    totem: config.axes.totem1.letters[poles.totem1] + config.axes.totem2.letters[poles.totem2],
    scores,
  };
}
