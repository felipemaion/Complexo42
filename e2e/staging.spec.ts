import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { QuestionnaireConfig } from "../src/modules/questionnaire/domain/schema";
import { acceptTermIfAsked } from "./accept-term";
import { chooseCity } from "./choose-city";

// Caminho inteiro no "staging de mentira" (#319), montado por scripts/staging-ci.sh como no servidor:
// banco só com migrations (sem seed), app pelo compose do deploy, proxy na frente e os passos de
// operador pelos scripts de deploy/. Sem chave de serviço: o teste só tem o que um operador tem
// (o navegador, o Mailpit e o bootstrap-coordenacao.sh). Roda com playwright.staging.config.ts.
const SITE = process.env.E2E_STAGING_URL;
const MAILPIT = process.env.E2E_STAGING_MAILPIT_URL;
const APP_CONTAINER = process.env.E2E_STAGING_APP_CONTAINER;
const DB_CONTAINER = process.env.E2E_STAGING_DB_CONTAINER;
// A conta já existe: com o cadastro fechado no servidor, o script a cria antes (ver scripts/staging-ci.sh).
const email = process.env.E2E_STAGING_EMAIL ?? "";
test.skip(!SITE || !MAILPIT || !APP_CONTAINER || !DB_CONTAINER || !email, "só no staging de mentira (scripts/staging-ci.sh)");

const questionnaire = JSON.parse(readFileSync("config/questionnaire.example.json", "utf8")) as QuestionnaireConfig;

/** O passo de operador do docs/OPERACAO.md ("Primeira coordenação"), pelo próprio script. */
function bootstrapCoordination(): string {
  return execFileSync("bash", ["deploy/bootstrap-coordenacao.sh"], {
    input: `${email}\n`,
    env: { ...process.env, APP_CONTAINER, DB_CONTAINER },
    encoding: "utf8",
  });
}

async function latestLink(request: APIRequestContext, after: number): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const msg = (list.messages ?? []).find((m: { Created: string }) => Date.parse(m.Created) >= after);
    if (msg) {
      const full = await (await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const href = /href="([^"]+)"/.exec(full.HTML)?.[1];
      if (href) return href.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("e-mail não chegou");
}

async function signInByEmail(page: Page, request: APIRequestContext): Promise<void> {
  const at = Date.now() - 1000;
  await page.goto("/entrar");
  await page.getByLabel("Seu e-mail").fill(email);
  // Turnstile (#116) com a chave de teste que sempre passa.
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 20_000 });
  await page.getByRole("button", { name: "Receber link por e-mail" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(/Se este e-mail puder entrar/);
  // No servidor o link é o do GoTrue (/auth/v1/verify → /auth/callback) e já entra; só o template
  // local (supabase/templates) leva à tela /auth/confirmar com o botão "Entrar".
  await page.goto(await latestLink(request, at));
  if (new URL(page.url()).pathname === "/auth/confirmar") await page.getByRole("button", { name: "Entrar" }).click();
}

test("banco novo: bootstrap → login → termo → questionário → casa → perfil → a coordenação vê o resultado", async ({ page, request, baseURL }) => {
  test.setTimeout(240_000);
  // Banco novo, ninguém pode autorizar ninguém: o operador põe o e-mail na lista.
  expect(bootstrapCoordination()).toContain("ainda precisa entrar");

  // Login pelo link mágico, com o e-mail saindo do GoTrue pelo SMTP.
  await signInByEmail(page, request);
  await acceptTermIfAsked(page);
  await expect(page).toHaveURL(`${baseURL}/casa`);

  // Termo do questionário: o banco só aceita a versão cadastrada pelo operador (questionario-banco.sh).
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  for (const _item of questionnaire.items) {
    await page.getByTestId("scale-5").click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  // O resultado é pontuado, cifrado e assinado no app e conferido no banco (pgcrypto em `extensions`).
  await expect(page.getByText("Sugerimos esta casa para você")).toBeVisible();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();

  await page.getByTestId("continue-link").click();
  await expect(page).toHaveURL(`${baseURL}/perfil`);
  await page.getByLabel("Seu nome").fill("Pessoa Staging");
  await page.getByLabel("Seu WhatsApp, com DDD").fill("11 999990000");
  await chooseCity(page, "São Paulo");
  await page.getByRole("button", { name: "Salvar meus dados" }).click();
  await expect(page).toHaveURL(`${baseURL}/inicio?salvo=1`);

  // Com perfil, o mesmo comando do operador dá o papel de gestora da raiz.
  expect(bootstrapCoordination()).toContain("concedido");

  // A coordenação nacional vê o resultado: o único do banco novo é o dela.
  await page.goto("/coordenacao/casas/resultados");
  const results = page.locator('a[href^="/coordenacao/casas/resultados/"]');
  await expect(results).toHaveCount(1);
  await results.click();
  await expect(page.getByTestId("result-totem")).toHaveText(/^.+ \([A-Z]{2}\)$/);
});
