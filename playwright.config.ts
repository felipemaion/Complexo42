import { defineConfig, devices } from "@playwright/test";

// Porta própria para não colidir com um `npm run dev` aberto na 3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);
// Sem Supabase (padrão, e o CI): Auth num endereço sem serviço e chave anon fictícia, só no
// formato. Com E2E_LIVE_SUPABASE_URL (Supabase local de pé, ver e2e/auth-live.spec.ts), os
// testes do fluxo real do link mágico também rodam.
const live = process.env.E2E_LIVE_SUPABASE_URL;
const E2E_SUPABASE_URL = live ?? "http://127.0.0.1:9";
const E2E_ANON_KEY =
  (live && process.env.E2E_LIVE_ANON_KEY) || `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"anon"}').toString("base64url")}.e2e`;
// Chaves de teste (ADR 0003), aleatórias a cada execução: o gancho do primeiro login (#26)
// compara o HMAC do e-mail com a lista de autorizados.
const randomKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
// A BLIND_INDEX_KEY do app também vai para os testes (e2e/fluxo-completo.spec.ts calcula o HMAC
// do e-mail que o gestor importa, como faria o servidor). O config roda de novo em cada worker:
// guardada no ambiente do processo principal, ela é a mesma em todos e no app.
process.env.E2E_BLIND_INDEX_KEY ||= randomKey();
// O webServer herda o process.env do Playwright: as chaves de serviço do Supabase local, só do
// processo de teste, saem do ambiente do app (valor undefined = variável ausente no filho, R6).
const testOnlySecrets = Object.fromEntries(
  Object.keys(process.env)
    .filter((name) => name.startsWith("E2E_LIVE_SERVICE"))
    .map((name) => [name, undefined]),
) as unknown as Record<string, string>;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Build de produção, igual ao que vai para o servidor (next build + next start).
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    // Em produção o app exige DB_HEALTH_URL e o Supabase e não sobe sem eles (src/server/env.ts).
    // Sem E2E_LIVE_SUPABASE_URL (job "E2E" do CI), URLs sem serviço deixam o healthz em 503 e o
    // login respondendo "indisponível", com o resto no ar; a chave é um JWT anon fictício, só no
    // formato. O job "E2E com banco" passa o Supabase local (ver .github/workflows/ci.yml).
    env: {
      ...testOnlySecrets,
      DB_HEALTH_URL: "http://127.0.0.1:9/ready",
      SUPABASE_URL: E2E_SUPABASE_URL,
      SUPABASE_ANON_KEY: E2E_ANON_KEY,
      SITE_URL: baseURL,
      FIELD_ENCRYPTION_KEY: randomKey(),
      BLIND_INDEX_KEY: process.env.E2E_BLIND_INDEX_KEY,
      // Igual ao de supabase/seed.sql (só desenvolvimento e testes, ADR 0014).
      QUESTIONNAIRE_SIGNING_KEY: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
      LOG_DIR: "test-results/logs",
      // Turnstile (#116): chaves de TESTE oficiais e públicas da Cloudflare, que sempre passam
      // (as mesmas de src/server/auth/turnstile.ts). Em produção as reais são obrigatórias.
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    },
  },
});
