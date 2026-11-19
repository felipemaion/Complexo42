// Validação na subida (#80): configuração inválida derruba o processo com a lista de
// variáveis problemáticas, sem imprimir valores. Importado por src/instrumentation.ts.
import { parseEnv } from "./env";
import { log } from "./log";

const result = parseEnv(process.env);
if (!result.ok) {
  log.error("env_invalid", { problems: result.problems });
  process.exit(1);
}
log.info("app_started", { version: result.env.APP_VERSION ?? "dev", commit: result.env.GIT_SHA ?? "unknown" });
