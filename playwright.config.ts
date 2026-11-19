import { defineConfig, devices } from "@playwright/test";

// Porta própria para não colidir com um `npm run dev` aberto na 3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

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
    // Em produção o app exige DB_HEALTH_URL e não sobe sem ela (src/server/env.ts, #80).
    // O E2E ainda não usa banco: uma URL sem serviço deixa o healthz em 503 e o resto no ar.
    env: { DB_HEALTH_URL: "http://127.0.0.1:9/ready", LOG_DIR: "test-results/logs" },
  },
});
