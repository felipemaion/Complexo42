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

// Chave pública (anon) do Supabase: JWT HS256 ou chave "publishable" das versões novas. A chave
// service_role é recusada aqui e em keyProblems (R6: nunca a chave de acesso total no app).
const anonKey = z.string().regex(/^(?:[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[\w-]+)$/, { error: "precisa ser a chave anon (JWT) ou sb_publishable_" });
const httpUrl = z.url({ protocol: /^https?$/, error: "precisa ser uma URL http(s)" });

// Chaves do Turnstile: "0x..." (produção) ou "1x/2x/3x..." (teste da Cloudflare).
const turnstileKey = z.string().regex(/^[0-9]x[\w-]{16,100}$/, { error: "formato de chave do Turnstile inválido" });

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
  // OBRIGATÓRIAS em produção (ver REQUIRED_IN_PRODUCTION): sem elas a checagem de
  // acesso falha com "missing_key" e NINGUÉM entra. Fora de produção seguem
  // opcionais. Quem cifra ou decifra sem elas recebe erro claro (src/server/crypto).
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
  // Assina o resultado do questionário que o app grava no banco (ADR 0014 §1). O mesmo valor fica
  // em `app.server_secrets` (docs/OPERACAO.md). Sem ela, o questionário não grava resultado.
  QUESTIONNAIRE_SIGNING_KEY: key32.optional(),
  // Questionário real das casas (ADR 0008 §2.1, #91), instalado só no servidor. OBRIGATÓRIA em
  // produção (#313): sem ela o app serviria em silêncio o exemplo fictício de
  // config/questionnaire.example.json, com a chave de exemplo, e a casa sairia calculada errada. Fora de
  // produção (desenvolvimento, testes) segue opcional e vale o exemplo. O conteúdo é validado na subida.
  QUESTIONNAIRE_PATH: z.string().optional(),
  // Login (#9, ADR 0009 §1). O app fala com o Supabase pela rede interna (SUPABASE_URL, ex.:
  // http://kong:8000). O navegador só vê o /auth/v1 publicado na origem pública
  // (SUPABASE_PUBLIC_URL; sem ela, vale SUPABASE_URL, como no local). SITE_URL é a origem
  // pública do app, usada nos endereços de retorno do login. Lidas em tempo de execução, e não
  // como NEXT_PUBLIC_*, para a mesma imagem servir staging e produção.
  SUPABASE_URL: httpUrl.optional(),
  SUPABASE_PUBLIC_URL: httpUrl.optional(),
  SUPABASE_ANON_KEY: anonKey.optional(),
  SITE_URL: httpUrl.optional(),
  // Repassar o CF-Connecting-IP ao GoTrue (rate limit por IP). Só ligue se o servidor garante
  // que apenas a Cloudflare alcança a origem; senão o cabeçalho pode ser forjado. Desligado
  // por padrão.
  TRUST_CF_CONNECTING_IP: z
    .enum(["true", "false"], { error: "use true ou false" })
    .default("false")
    .transform((v) => v === "true"),
  // Cloudflare Turnstile no pedido do link por e-mail (#116). A site key é pública, mas é lida
  // aqui em tempo de execução (sem NEXT_PUBLIC_) e passada à tela; a secret só fica no
  // servidor. Fora de produção, sem valor, valem as chaves de teste oficiais (turnstile.ts).
  TURNSTILE_SITE_KEY: turnstileKey.optional(),
  TURNSTILE_SECRET_KEY: turnstileKey.optional(),
});

// Obrigatórias só em produção. Checadas fora do schema para aparecerem junto com os
// demais erros (o Zod pula refinamentos quando algum campo já falhou).
// As chaves de cifra entram aqui para o app RECUSAR SUBIR sem elas, em vez de
// subir e falhar no primeiro uso -- que e o login. Opcional na subida produziu
// um staging que subia saudavel, respondia 200 no /api/healthz e recusava toda
// entrada com `missing_key`; custou duas rodadas de diagnostico para achar.
//
// Esta exigencia ja derrubou o staging uma vez (#283, 502 por ~9 min) e foi
// desarmada no #285: a imagem exigente chegou pelo deploy e o
// `docker-compose.app.yml` do SERVIDOR -- copia instalada, nao sincronizada --
// nao as repassava. A licao nao era "nao exigir", era ORDEM DE OPERACOES: a
// exigencia so pode nascer DEPOIS de o ambiente ter o que ela exige. Em
// 2026-11-28 o compose do servidor passou a repassar as duas, conferido dentro
// do container, e por isso ela volta aqui.
//
// QUESTIONNAIRE_SIGNING_KEY entrou em 2026-11-28 (#290): o staging a tem no `secrets/env` e no compose, o
// `gen-secrets.sh` a gera para todo ambiente novo, e a producao ainda nao existe. Sem ela o resultado do
// questionario nao grava, entao recusar a subida troca uma tela quebrada por um erro claro na subida.
const REQUIRED_IN_PRODUCTION = [
  "DB_HEALTH_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SITE_URL",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "FIELD_ENCRYPTION_KEY",
  "BLIND_INDEX_KEY",
  "QUESTIONNAIRE_PATH",
  "QUESTIONNAIRE_SIGNING_KEY",
] as const;

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
  if (result.success) problems.push(...keyProblems(result.data), ...authProblems(result.data));
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

// R6: recusa uma chave JWT cujo papel não seja `anon` (ex.: service_role colada por engano).
function authProblems(env: ServerEnv): string[] {
  const key = env.SUPABASE_ANON_KEY;
  if (!key || key.startsWith("sb_publishable_")) return [];
  let role: unknown;
  try {
    role = (JSON.parse(Buffer.from(key.split(".")[1] as string, "base64url").toString("utf8")) as { role?: unknown }).role;
  } catch {
    role = undefined;
  }
  return role === "anon" ? [] : ["SUPABASE_ANON_KEY: precisa ser a chave anon (nunca service_role)"];
}

/** Lê o ambiente atual. A subida (instrumentation.ts) já derrubou o processo se ele for inválido. */
export function getEnv(): ServerEnv {
  const result = parseEnv(process.env);
  if (!result.ok) throw new Error("Configuração inválida; veja o log de subida.");
  return result.env;
}
