// Configuração do servidor só por variáveis de ambiente, validadas com Zod (#80).
// As mensagens citam o NOME da variável, nunca o valor: elas vão para o log.
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"], { error: "use development, test ou production" }).default("development"),
  // URL interna que responde 2xx quando o banco está de pé (PostgREST /ready).
  DB_HEALTH_URL: z.url({ protocol: /^https?$/, error: "precisa ser uma URL http(s)" }).optional(),
  HEALTH_TIMEOUT_MS: z.coerce
    .number({ error: "precisa ser um número" })
    .int({ error: "precisa ser inteiro" })
    .min(100, { error: "mínimo 100" })
    .max(10_000, { error: "máximo 10000" })
    .default(2000),
  LOG_DIR: z.string().default("data/logs"),
  GIT_SHA: z.string().regex(/^[0-9a-f]{7,40}$/, { error: "precisa ser um hash de commit" }).optional(),
  APP_VERSION: z.string().regex(/^[\w.+-]{1,64}$/, { error: "formato de tag inválido" }).optional(),
});

// Obrigatórias só em produção. Checadas fora do schema para aparecerem junto com os
// demais erros (o Zod pula refinamentos quando algum campo já falhou).
const REQUIRED_IN_PRODUCTION = ["DB_HEALTH_URL"] as const;

export type ServerEnv = z.infer<typeof envSchema>;

export type EnvResult = { ok: true; env: ServerEnv } | { ok: false; problems: string[] };

export function parseEnv(raw: Record<string, string | undefined>): EnvResult {
  // Variável vazia conta como ausente (ex.: ARG do Docker sem valor).
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ""));
  const result = envSchema.safeParse(cleaned);
  const problems = result.success ? [] : result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
  if (cleaned.NODE_ENV === "production") {
    for (const key of REQUIRED_IN_PRODUCTION) if (!(key in cleaned)) problems.push(`${key}: obrigatória em produção`);
  }
  if (result.success && problems.length === 0) return { ok: true, env: result.data };
  return { ok: false, problems };
}

/** Lê o ambiente atual. A subida (instrumentation.ts) já derrubou o processo se ele for inválido. */
export function getEnv(): ServerEnv {
  const result = parseEnv(process.env);
  if (!result.ok) throw new Error("Configuração inválida; veja o log de subida.");
  return result.env;
}
