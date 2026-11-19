import example from "@config/questionnaire.example.json";
import { parseQuestionnaire, QuestionnaireConfigError, type QuestionnaireConfig } from "../domain/schema";

/** Lê um arquivo de texto. Injetado para o módulo não fazer I/O próprio (e ser testável). */
export type ReadText = (path: string) => string;

/**
 * Carrega o questionário na subida do app (ADR 0008 §2.1). Com QUESTIONNAIRE_PATH, lê o
 * arquivo real instalado no servidor; sem ela, usa o exemplo fictício de `config/`. Qualquer
 * problema vira QuestionnaireConfigError com nomes de campos, nunca com o conteúdo do arquivo.
 */
export function loadQuestionnaire(
  path: string | undefined,
  readText: ReadText,
  houseIds: readonly string[],
): Readonly<QuestionnaireConfig> {
  if (!path) return parseQuestionnaire(example, houseIds);
  let raw: string;
  try {
    raw = readText(path);
  } catch {
    throw new QuestionnaireConfigError(["QUESTIONNAIRE_PATH (arquivo ilegível)"]);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new QuestionnaireConfigError(["QUESTIONNAIRE_PATH (JSON inválido)"]);
  }
  return parseQuestionnaire(json, houseIds);
}
