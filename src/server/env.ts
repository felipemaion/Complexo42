// Configuração do servidor só por variáveis de ambiente, validadas com Zod (#80).
// As mensagens citam o NOME da variável, nunca o valor: elas vão para o log.
import { z } from "zod";

// Chaves de criptografia de campo (ADR 0003, #45). 32 bytes em base64 padrão, como gera
// `openssl rand -base64 32` (deploy/gen-secrets.sh). Decodificação estrita: o Buffer aceita
// lixo em silêncio, então exigimos que a volta para base64 dê exatamente o texto recebido.
export function decodeKey(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 && bytes.toString("base64") === value ? new Uint8Array(bytes) : null;
}

/**
 * Chaves antigas, mantidas só para decifrar durante uma rotação: "v1:<base64>,v2:<base64>".
 * Devolve null se o formato for inválido ou se uma versão se repetir.
 */
export function parsePreviousKeys(value: string): Map<number, Uint8Array> | null {
  const keys = new Map<number, Uint8Array>();
  for (const item of value.split(",")) {
    const match = /^v([1-9]\d{0,2}):(.+)$/.exec(item.trim());
    const key = match ? decodeKey(match[2] as string) : null;
    const version = Number(match?.[1]);
    if (!key || keys.has(version)) return null;
    keys.set(version, key);
  }
  return keys;
}

const key32 = z.string().refine((v) => decodeKey(v) !== null, { error: "precisa ter 32 bytes em base64 (openssl rand -base64 32)" });

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
  // Opcionais na subida: rota que não usa criptografia não depende delas. Quem cifra ou
  // decifra sem elas recebe erro claro (src/server/crypto, código "missing_key").
  FIELD_ENCRYPTION_KEY: key32.optional(),
  FIELD_ENCRYPTION_KEY_VERSION: z.coerce
    .number({ error: "precisa ser um número" })
    .int({ error: "precisa ser inteiro" })
    .min(1, { error: "mínimo 1" })
    .max(999, { error: "máximo 999" })
    .default(1),
  FIELD_ENCRYPTION_PREVIOUS_KEYS: z
    .string()
    .refine((v) => parsePreviousKeys(v) !== null, { error: "formato v1:<base64>,v2:<base64> com chaves de 32 bytes" })
    .optional(),
  BLIND_INDEX_KEY: key32.optional(),
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
  if (result.success) problems.push(...keyProblems(result.data));
  if (result.success && problems.length === 0) return { ok: true, env: result.data };
  return { ok: false, problems };
}

// Coerência entre as chaves. Só cita nomes de variáveis, nunca valores.
function keyProblems(env: ServerEnv): string[] {
  const problems: string[] = [];
  const field = env.FIELD_ENCRYPTION_KEY;
  const previous = env.FIELD_ENCRYPTION_PREVIOUS_KEYS ? parsePreviousKeys(env.FIELD_ENCRYPTION_PREVIOUS_KEYS) : null;
  if (field && env.BLIND_INDEX_KEY === field) problems.push("BLIND_INDEX_KEY: precisa ser diferente de FIELD_ENCRYPTION_KEY");
  if (previous && !field) problems.push("FIELD_ENCRYPTION_PREVIOUS_KEYS: exige FIELD_ENCRYPTION_KEY");
  const blind = env.BLIND_INDEX_KEY ? decodeKey(env.BLIND_INDEX_KEY) : null;
  for (const key of previous?.values() ?? []) {
    if (blind && Buffer.from(key).equals(Buffer.from(blind))) problems.push("FIELD_ENCRYPTION_PREVIOUS_KEYS: nenhuma chave antiga pode ser igual a BLIND_INDEX_KEY");
  }
  for (const version of previous?.keys() ?? []) {
    if (version >= env.FIELD_ENCRYPTION_KEY_VERSION) problems.push("FIELD_ENCRYPTION_PREVIOUS_KEYS: versões antigas precisam ser menores que FIELD_ENCRYPTION_KEY_VERSION");
  }
  return [...new Set(problems)];
}

/** Lê o ambiente atual. A subida (instrumentation.ts) já derrubou o processo se ele for inválido. */
export function getEnv(): ServerEnv {
  const result = parseEnv(process.env);
  if (!result.ok) throw new Error("Configuração inválida; veja o log de subida.");
  return result.env;
}
