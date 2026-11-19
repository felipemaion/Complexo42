// Validação na subida (#80): configuração inválida derruba o processo com a lista de
// variáveis problemáticas, sem imprimir valores. Importado por src/instrumentation.ts.
import { readFileSync } from "node:fs";
import { instance } from "@config/instance";
import { loadQuestionnaire, QuestionnaireConfigError } from "@/modules/questionnaire";
import { parseEnv } from "./env";
import { log } from "./log";

const result = parseEnv(process.env);
if (!result.ok) {
  log.error("env_invalid", { problems: result.problems });
  process.exit(1);
}

// Questionário das casas (#91): inválido derruba a subida citando só os campos.
try {
  loadQuestionnaire(result.env.QUESTIONNAIRE_PATH, (path) => readFileSync(path, "utf8"), instance.houses.map((h) => h.id));
} catch (err) {
  if (!(err instanceof QuestionnaireConfigError)) throw err;
  log.error("questionnaire_invalid", { fields: err.fields });
  process.exit(1);
}
log.info("app_started", { version: result.env.APP_VERSION ?? "dev", commit: result.env.GIT_SHA ?? "unknown" });
