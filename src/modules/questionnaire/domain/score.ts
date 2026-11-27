import type { Axis, Pole, QuestionnaireConfig } from "./schema";

/*
 * Pontuação do questionário (ADR 0014, #172 e #183). Função pura: sem I/O, sem data, sem estado.
 * Roda só no servidor (ADR 0014 §1): o navegador não recebe a chave. As respostas não são
 * guardadas; as notas por eixo ficam guardadas, cifradas, junto do resultado.
 */

/**
 * Intensidade da resposta, seis níveis e sem meio, com pesos 1, 3 e 5 por lado: negativo é o polo
 * "a" (-5 muito a), positivo é o polo "b" (5 muito b). Todos ímpares: com número ímpar de itens
 * por eixo (conferido na carga da config) a soma nunca é zero.
 */
export const answerValues = [-5, -3, -1, 1, 3, 5] as const;
export type Answer = (typeof answerValues)[number];
export type Answers = Readonly<Record<string, Answer>>;

/** Maior intensidade possível de uma resposta (a nota do eixo é normalizada por ela). */
const maxIntensity = 5;

/** Nota de cada eixo, inteira de -100 (tudo "muito a") a 100 (tudo "muito b"). */
export type AxisScores = Readonly<Record<Axis, number>>;

/** A casa sugerida, o totem e as notas dos eixos (sem as respostas). Todo resultado é conclusivo: não há empate. */
export type QuestionnaireResult = { status: "ok"; houseId: string; totem: string; scores: AxisScores };

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
      invalid_answer: "resposta fora de -5, -3, -1, 1, 3 e 5",
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

/** Polo do eixo pelo sinal da soma (a média tem o mesmo sinal); nunca é zero (itens ímpares, pesos ímpares). */
function poleOf(config: QuestionnaireConfig, axis: Axis, answers: Answers): Pole {
  return sumOf(config.axes[axis].itemIds, answers) < 0 ? "a" : "b";
}

/**
 * Transforma as respostas na casa sugerida, no totem e nas notas dos eixos. A casa é a
 * interseção dos polos dos eixos 1 e 2; o totem, as letras dos polos dos eixos 3 e 4.
 */
export function scoreQuestionnaire(config: QuestionnaireConfig, answers: Answers): QuestionnaireResult {
  checkAnswers(config, answers);
  const scores: AxisScores = {
    house1: scoreOf(config.axes.house1.itemIds, answers),
    house2: scoreOf(config.axes.house2.itemIds, answers),
    totem1: scoreOf(config.axes.totem1.itemIds, answers),
    totem2: scoreOf(config.axes.totem2.itemIds, answers),
  };
  const pole = (axis: Axis) => poleOf(config, axis, answers);
  return {
    status: "ok",
    houseId: config.houseByPoles[`${pole("house1")}${pole("house2")}`],
    totem: config.axes.totem1.letters[pole("totem1")] + config.axes.totem2.letters[pole("totem2")],
    scores,
  };
}
