import { defineConfig, devices } from "@playwright/test";

// Porta própria para não colidir com um `npm run dev` aberto na 3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);
const E2E_SUPABASE_URL = "http://127.0.0.1:9";
const E2E_ANON_KEY = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"anon"}').toString("base64url")}.e2e`;

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
    // O E2E não usa banco nem Auth (o CI não sobe o Supabase aqui): URLs sem serviço deixam o
    // healthz em 503 e o login respondendo "indisponível", com o resto no ar. A chave é um JWT
    // anon fictício, só no formato.
    env: {
      DB_HEALTH_URL: "http://127.0.0.1:9/ready",
      SUPABASE_URL: E2E_SUPABASE_URL,
      SUPABASE_ANON_KEY: E2E_ANON_KEY,
      SITE_URL: baseURL,
      LOG_DIR: "test-results/logs",
    },
  },
});
