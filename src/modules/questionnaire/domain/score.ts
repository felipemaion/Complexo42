import { axes, type Axis, type Pole, type QuestionnaireConfig, type Temperament } from "./schema";

/*
 * Pontuação do questionário (ADR 0008 §2.1, #91). Função pura: sem I/O, sem data, sem estado.
 * Roda no navegador; as respostas não saem do dispositivo e não são guardadas. O retorno traz
 * só o temperamento e a casa sugerida.
 */

/** Resposta de um item: alternativa a, b, ou as duas (indecisão). */
export type Answer = "a" | "b" | "both";
export type Answers = Readonly<Record<string, Answer>>;

export type QuestionnaireResult = { temperament: Temperament; houseId: string };

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

/**
 * Pontos por polo, em meios pontos inteiros para evitar fração: uma alternativa vale 2 para o
 * seu polo; "as duas" vale 1 para cada polo (meio ponto, até a pergunta 75 dizer outra coisa).
 */
function tally(config: QuestionnaireConfig, answers: Answers): Record<Pole, number> {
  const points: Record<Pole, number> = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
  for (const item of config.items) {
    const answer = answers[item.id];
    if (answer === "a" || answer === "both") points[item.a.pole] += answer === "a" ? 2 : 1;
    if (answer === "b" || answer === "both") points[item.b.pole] += answer === "b" ? 2 : 1;
  }
  return points;
}

function winner(axis: Axis, points: Record<Pole, number>, config: QuestionnaireConfig): Pole {
  const [first, second] = axes[axis];
  if (points[first] === points[second]) return config.tieBreak[axis];
  return points[first] > points[second] ? first : second;
}

/**
 * Transforma as respostas na casa sugerida. Temperamento de Keirsey: com S, o par é SJ ou SP
 * (eixo J/P); com N, é NT ou NF (eixo T/F). O eixo E/I entra na contagem mas não na casa.
 */
export function scoreQuestionnaire(config: QuestionnaireConfig, answers: Answers): QuestionnaireResult {
  checkAnswers(config, answers);
  const points = tally(config, answers);
  const perception = winner("SN", points, config);
  const temperament: Temperament =
    perception === "S" ? (winner("JP", points, config) === "J" ? "SJ" : "SP") : winner("TF", points, config) === "T" ? "NT" : "NF";
  return { temperament, houseId: config.houseByTemperament[temperament] };
}
