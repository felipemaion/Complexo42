import type { Axis, Pole, QuestionnaireConfig } from "./schema";

/*
 * Pontuação do questionário (ADR 0014, #172). Função pura: sem I/O, sem data, sem estado. Roda
 * no navegador; as respostas só saem do aparelho no caso inconclusivo, para o pedido de análise
 * da coordenação nacional (ADR 0014 §3). Com resultado conclusivo, vão só a casa e o totem.
 */

/** Resposta de um item: alternativa a, b, ou as duas (indecisão). */
export type Answer = "a" | "b" | "both";
export type Answers = Readonly<Record<string, Answer>>;

/**
 * Conclusivo: a casa sugerida e o totem. Inconclusivo: nenhum eixo decidido por um polo
 * (empate sem desempate); `axes` lista os eixos empatados, sem as respostas.
 */
export type QuestionnaireResult =
  | { status: "ok"; houseId: string; totem: string }
  | { status: "inconclusive"; axes: readonly Axis[] };

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
      invalid_answer: "resposta diferente de a, b ou both",
    }[code];
    super(`Respostas inválidas (${reason}): ${itemIds.join(", ")}`);
    this.name = "QuestionnaireAnswerError";
  }
}

const VALID: readonly string[] = ["a", "b", "both"] satisfies Answer[];

function checkAnswers(config: QuestionnaireConfig, answers: Answers): void {
  const ids = new Set(config.items.map((item) => item.id));
  const unknown = Object.keys(answers).filter((id) => !ids.has(id));
  if (unknown.length > 0) throw new QuestionnaireAnswerError("unknown_item", unknown);
  const missing = config.items.filter((item) => !Object.hasOwn(answers, item.id)).map((item) => item.id);
  if (missing.length > 0) throw new QuestionnaireAnswerError("missing_answer", missing);
  const invalid = config.items.filter((item) => !VALID.includes(answers[item.id] as string)).map((item) => item.id);
  if (invalid.length > 0) throw new QuestionnaireAnswerError("invalid_answer", invalid);
}

/** Polo vencedor entre os itens dados: cada resposta vale 1 ponto, e "as duas" vale 1 para cada polo. */
function winnerAmong(itemIds: readonly string[], answers: Answers): Pole | null {
  let a = 0;
  let b = 0;
  for (const id of itemIds) {
    const answer = answers[id];
    if (answer === "a" || answer === "both") a += 1;
    if (answer === "b" || answer === "both") b += 1;
  }
  if (a === b) return null;
  return a > b ? "a" : "b";
}

/** Polo do eixo; em empate, desempata pelos itens indicados; ainda empatado, `null`. */
function poleOf(config: QuestionnaireConfig, axis: Axis, answers: Answers): Pole | null {
  const { itemIds, tieBreakItems } = config.axes[axis];
  return winnerAmong(itemIds, answers) ?? winnerAmong(tieBreakItems, answers);
}

/**
 * Transforma as respostas na casa sugerida e no totem. A casa é a interseção dos polos dos
 * eixos 1 e 2; o totem, as letras dos polos dos eixos 3 e 4. Se algum eixo empata sem
 * desempate, o resultado é inconclusivo: nenhuma casa é atribuída (ADR 0014 §2).
 */
export function scoreQuestionnaire(config: QuestionnaireConfig, answers: Answers): QuestionnaireResult {
  checkAnswers(config, answers);
  const poles = {
    house1: poleOf(config, "house1", answers),
    house2: poleOf(config, "house2", answers),
    totem1: poleOf(config, "totem1", answers),
    totem2: poleOf(config, "totem2", answers),
  };
  const tied = (Object.keys(poles) as Axis[]).filter((axis) => poles[axis] === null);
  if (poles.house1 === null || poles.house2 === null || poles.totem1 === null || poles.totem2 === null) {
    return { status: "inconclusive", axes: tied };
  }
  return {
    status: "ok",
    houseId: config.houseByPoles[`${poles.house1}${poles.house2}`],
    totem: config.axes.totem1.letters[poles.totem1] + config.axes.totem2.letters[poles.totem2],
  };
}
