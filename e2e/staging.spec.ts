import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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
// As contas já existem: com o cadastro fechado no servidor, o script as cria antes (ver scripts/staging-ci.sh).
const coordinatorEmail = process.env.E2E_STAGING_EMAIL ?? "";
const memberEmail = process.env.E2E_STAGING_MEMBER_EMAIL ?? "";
// Sem `test.skip`: faltando uma variável, o caso principal tem de FALHAR, não passar pulado (revisão do
// #333). Fora do staging, o playwright.config.ts nem coleta este arquivo (testIgnore).
const missing = Object.entries({ SITE, MAILPIT, APP_CONTAINER, DB_CONTAINER, coordinatorEmail, memberEmail })
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length > 0) throw new Error(`staging de mentira sem configuração: ${missing.join(", ")} (rode por scripts/staging-ci.sh)`);

const questionnaire = JSON.parse(readFileSync("config/questionnaire.example.json", "utf8")) as QuestionnaireConfig;

/** O passo de operador do docs/OPERACAO.md ("Primeira coordenação"), pelo próprio script. */
function bootstrapCoordination(): string {
  return execFileSync("bash", ["deploy/bootstrap-coordenacao.sh"], {
    input: `${coordinatorEmail}\n`,
    env: { ...process.env, APP_CONTAINER, DB_CONTAINER },
    encoding: "utf8",
  });
}

async function latestLink(request: APIRequestContext, email: string, after: number): Promise<string> {
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

/** Login pelo link mágico, com o e-mail saindo do GoTrue pelo SMTP. */
async function signInByEmail(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const at = Date.now() - 1000;
  await page.goto("/entrar");
  // Cadastro fechado no servidor (#332): o aviso é o mesmo para todos, antes de digitar qualquer e-mail.
  await expect(page.getByTestId("signup-closed")).toBeVisible();
  await page.getByLabel("Seu e-mail").fill(email);
  // Turnstile (#116) com a chave de teste que sempre passa.
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 20_000 });
  await page.getByRole("button", { name: "Receber link por e-mail" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(/Se este e-mail puder entrar/);
  // No servidor o link é o do GoTrue (/auth/v1/verify → /auth/callback) e já entra; só o template
  // local (supabase/templates) leva à tela /auth/confirmar com o botão "Entrar".
  await page.goto(await latestLink(request, email, at));
  if (new URL(page.url()).pathname === "/auth/confirmar") await page.getByRole("button", { name: "Entrar" }).click();
}

/** Login → termo → questionário → casa → perfil, pela interface. */
async function joinThroughQuestionnaire(page: Page, request: APIRequestContext, email: string, name: string, baseURL: string): Promise<string> {
  await signInByEmail(page, request, email);
  await acceptTermIfAsked(page);
  await expect(page).toHaveURL(`${baseURL}/casa`);
  // Termo do questionário: o banco só aceita a versão cadastrada pelo operador (questionario-banco.sh).
  await page.getByRole("button", { name: "Aceito e quero responder" }).click();
  for (let i = 0; i < questionnaire.items.length; i++) {
    await page.getByTestId("scale-5").click();
    await page.getByRole("button", { name: /^(Próxima|Ver o resultado)$/ }).click();
  }
  // O resultado é pontuado, cifrado e assinado no app e conferido no banco (pgcrypto em `extensions`).
  await expect(page.getByText("Sugerimos esta casa para você")).toBeVisible();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();

  await page.getByTestId("continue-link").click();
  await expect(page).toHaveURL(`${baseURL}/perfil`);
  await page.getByLabel("Seu nome").fill(name);
  // Devolve o trecho do WhatsApp digitado (9 + 8 dígitos): a varredura de dados em claro o procura no banco (#155).
  const whatsapp = `9${String(Date.now()).slice(-8)}`;
  await page.getByLabel("Seu WhatsApp, com DDD").fill(`11 ${whatsapp}`);
  await chooseCity(page, "São Paulo");
  await page.getByRole("button", { name: "Salvar meus dados" }).click();
  await expect(page).toHaveURL(`${baseURL}/inicio?salvo=1`);
  return whatsapp;
}

// #156: o nome da segunda pessoa é um payload de XSS (o nome aceita qualquer texto de 2 a 80 caracteres). Nas telas
// da coordenação ele tem de aparecer como TEXTO: nenhum diálogo, nenhum script e nenhum elemento do payload.
const XSS_NAME = 'Pessoa <img src=x onerror="window.__xss=1">';

/** Registra os diálogos que abrirem na página, para o teste conferir que nenhum abriu. */
function watchDialogs(page: Page): string[] {
  const opened: string[] = [];
  page.on("dialog", (dialog) => {
    opened.push(dialog.message());
    void dialog.dismiss();
  });
  return opened;
}

async function expectInert(page: Page, dialogs: string[]) {
  expect(dialogs, "nenhum diálogo pode abrir").toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), "o script do payload não pode rodar").toBeUndefined();
  await expect(page.locator("img[src='x']"), "o <img> do payload não pode entrar na página").toHaveCount(0);
}

test("banco novo: bootstrap → login → termo → questionário → casa → a coordenação autoriza e vê o resultado", async ({ browser, request, baseURL }) => {
  test.setTimeout(300_000);
  // Banco novo, ninguém pode autorizar ninguém: o operador põe o e-mail da coordenação na lista.
  expect(bootstrapCoordination()).toContain("ainda precisa entrar");
  const coordinator = await (await browser.newContext()).newPage();
  const coordinatorDialogs = watchDialogs(coordinator);
  const coordinatorWhatsapp = await joinThroughQuestionnaire(coordinator, request, coordinatorEmail, "Coordenação Staging", baseURL!);
  // Com perfil e casa, o mesmo comando do operador dá o papel de gestora da raiz.
  expect(bootstrapCoordination()).toContain("concedido");

  // A coordenação autoriza a segunda pessoa pela tela.
  await coordinator.goto("/coordenacao/autorizados");
  await coordinator.getByLabel("E-mail", { exact: true }).fill(memberEmail);
  await coordinator.getByRole("button", { name: "Adicionar" }).click();
  await expect(coordinator.getByTestId("allowlist-add-done")).toHaveText("Adicionado");

  const member = await (await browser.newContext()).newPage();
  const memberDialogs = watchDialogs(member);
  const memberWhatsapp = await joinThroughQuestionnaire(member, request, memberEmail, XSS_NAME, baseURL!);
  await expectInert(member, memberDialogs);

  // Os trechos que digitamos, para o scripts/staging-ci/varredura.sh procurar em claro no banco (#155). Só dado fictício, em
  // arquivo do diretório temporário do job; sem a variável (fora do script do job) não grava nada.
  if (process.env.E2E_STAGING_TRECHOS_FILE) {
    writeFileSync(
      process.env.E2E_STAGING_TRECHOS_FILE,
      [`claro:${XSS_NAME}`, "claro:Coordenação Staging", `claro:${memberWhatsapp}`, `claro:${coordinatorWhatsapp}`, `email:${coordinatorEmail}`, `email:${memberEmail}`].join("\n") + "\n",
      { mode: 0o600 },
    );
  }

  // A coordenação nacional vê os resultados do banco novo: o dela (#318) e o da pessoa.
  await coordinator.goto("/coordenacao/casas/resultados");
  const results = coordinator.locator('a[href^="/coordenacao/casas/resultados/"]');
  await expect(results).toHaveCount(2);
  // O nome da 2ª pessoa (o payload) aparece na lista como TEXTO, sem executar nada. Sem os estados por migration (#365) a
  // coordenação não lia o nome de ninguém além do dela, e a linha mostrava "sem nome".
  await expect(coordinator.getByTestId("result-row").filter({ hasText: XSS_NAME })).toHaveCount(1);
  await expectInert(coordinator, coordinatorDialogs);
  await results.first().click();
  await expect(coordinator.getByTestId("result-totem")).toHaveText(/^.+ \([A-Z]{2}\)$/);
  await expectInert(coordinator, coordinatorDialogs);
  // E nas outras telas da coordenação que listam pessoas.
  for (const path of ["/coordenacao/pessoas", "/coordenacao/espera"]) {
    await coordinator.goto(path);
    await expectInert(coordinator, coordinatorDialogs);
  }

  // #155: exportar, excluir e varrer de novo. Antes de excluir, o banco inteiro sem o texto em claro das duas pessoas; o
  // script devolve só `esquema.tabela.coluna` (nunca o valor), e o teste falha com esse resultado.
  const trechosFile = process.env.E2E_STAGING_TRECHOS_FILE;
  const scan = () => {
    if (trechosFile) execFileSync("bash", ["scripts/staging-ci/varredura.sh", trechosFile], { env: { ...process.env, DB: DB_CONTAINER }, encoding: "utf8" });
  };
  scan();

  // "Baixar meus dados": o arquivo da 2ª pessoa traz o nome dela (decifrado só na resposta), e nada da coordenação.
  await member.goto("/inicio");
  const [file] = await Promise.all([member.waitForEvent("download"), member.getByRole("button", { name: "Baixar meus dados" }).click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  const exported = Buffer.concat(chunks).toString("utf8");
  const data = JSON.parse(exported);
  expect(data.perfil.nome).toBe(XSS_NAME);
  expect(data.conta.emailDeLogin).toBe(memberEmail);
  expect(data.contato.whatsapp).toContain(memberWhatsapp);
  for (const other of [coordinatorEmail, "Coordenação Staging", coordinatorWhatsapp]) expect(exported).not.toContain(other);

  // "Excluir minha conta": a 2ª pessoa se exclui pela interface (login de menos de 10 minutos, a palavra EXCLUIR).
  await member.goto("/excluir-conta");
  await member.getByLabel(/escreva EXCLUIR/).fill("EXCLUIR");
  await member.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
  await expect(member).toHaveURL(`${baseURL}/conta-excluida`);
  await expectInert(member, memberDialogs);

  // A coordenação passa a ver só o resultado dela, e nada da pessoa excluída sobra no banco: nem em `auth.*` (o e-mail agora
  // também não pode estar lá). A varredura do job (scripts/staging-ci.sh) roda de novo, com este arquivo.
  await coordinator.goto("/coordenacao/casas/resultados");
  await expect(coordinator.locator('a[href^="/coordenacao/casas/resultados/"]')).toHaveCount(1);
  await expect(coordinator.getByTestId("result-row").filter({ hasText: XSS_NAME })).toHaveCount(0);
  if (trechosFile) {
    writeFileSync(
      trechosFile,
      [`claro:${XSS_NAME}`, `claro:${memberWhatsapp}`, `claro:${memberEmail}`, "claro:Coordenação Staging", `claro:${coordinatorWhatsapp}`, `email:${coordinatorEmail}`].join("\n") + "\n",
      { mode: 0o600 },
    );
  }
  scan();
});
