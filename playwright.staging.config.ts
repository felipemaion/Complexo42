import { defineConfig, devices } from "@playwright/test";

// Só o e2e/staging.spec.ts, contra o "staging de mentira" que scripts/staging-ci.sh monta (#319).
// Sem webServer: o app é o container do compose do deploy, atrás do proxy. Sem retry: num caso
// revertido o teste TEM de falhar, e um retry só dobraria o tempo do job.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "staging.spec.ts",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_STAGING_URL,
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
