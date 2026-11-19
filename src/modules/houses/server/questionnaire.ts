// O questionário real é lido no servidor (QUESTIONNAIRE_PATH, ou o exemplo de config/) e vai
// para a tela como dado (#76, ADR 0008 §2.1). O boot já validou o arquivo (src/server/boot.ts);
// aqui ele é carregado uma vez por processo.
import "server-only";
import { readFileSync } from "node:fs";
import { instance } from "@config/instance";
import { loadQuestionnaire, type QuestionnaireConfig } from "@/modules/questionnaire";

let cached: Readonly<QuestionnaireConfig> | undefined;

export function getQuestionnaire(): Readonly<QuestionnaireConfig> {
  cached ??= loadQuestionnaire(
    process.env.QUESTIONNAIRE_PATH || undefined,
    (path) => readFileSync(path, "utf8"),
    instance.houses.map((h) => h.id),
  );
  return cached;
}
