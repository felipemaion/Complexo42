import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { acceptTermIfAsked } from "./accept-term";

// Fluxo completo do cadastro (#21), de ponta a ponta, contra o Supabase local com o Mailpit (o
// job "E2E com banco" do CI sobe os dois). Uma pessoa nova percorre tudo pela interface:
// lista de autorizados → link mágico pelo e-mail → perfil → casa → quem vê o contato → baixar
// os dados → excluir a conta. Outra, fora da lista, cai na espera e é liberada quando o gestor
// importa o e-mail dela. O aceite do termo (#11) entra no começo, antes do perfil.
//
// Para rodar localmente (stack de pé, `site_url` do supabase/config.toml na porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> E2E_MAILPIT_URL=<MAILPIT_URL> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY> npm run test:e2e -- e2e/fluxo-completo.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste: cria o gestor da raiz (o
// "seed" do teste) e confere o banco. O app nunca a recebe (R6, playwright.config.ts).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const ANON_KEY = process.env.E2E_LIVE_ANON_KEY;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY;
const MAILPIT = process.env.E2E_MAILPIT_URL;
// Mesma chave que o app recebe (playwright.config.ts).
const BLIND_INDEX_KEY = process.env.E2E_BLIND_INDEX_KEY;
test.skip(!API || !ANON_KEY || !SERVICE_KEY || !MAILPIT || !BLIND_INDEX_KEY, "precisa do Supabase local, do Mailpit e das chaves locais (ver o topo do arquivo)");
test.describe.configure({ mode: "serial" });

const run = Date.now();
const SAO_PAULO = 3550308;

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
const rows = async (path: string) => (await (await admin(`/rest/v1/${path}`)).json()) as unknown[];

/** O que o servidor manda ao banco no lugar do e-mail (src/server/crypto, ADR 0008 §1). */
const emailHmac = (email: string) =>
  createHmac("sha256", Buffer.from(BLIND_INDEX_KEY!, "base64")).update(`em:${email.trim().toLowerCase()}`).digest("hex");

/**
 * Gestor da raiz, criado pelo teste: conta confirmada, perfil ativo e papel `manager` na
 * unidade nacional. Devolve o JWT dele, que é o que o servidor usaria na importação.
 */
async function createRootManager(): Promise<string> {
  const email = `gestor.raiz.${run}@exemplo.org`;
  const user = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, email_confirm: true }) })).json();
  const profile = await admin("/rest/v1/profiles", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      id: user.id,
      // Valor só no formato do cifrado: o teste não exibe o nome do gestor.
      display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
      municipality_code: SAO_PAULO,
      consent_version: "v1",
      access_status: "active",
      status: "active",
    }),
  });
  expect(profile.status).toBe(201);
  // Já aceitou o termo vigente (#11): sem a linha, o portão manda a pessoa para /termo.
  await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, version: "v1" }) });
  const [root] = await (await admin("/rest/v1/units?parent_id=is.null&select=id")).json();
  const role = await admin("/rest/v1/role_assignments", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ profile_id: user.id, role: "manager", unit_id: root.id }),
  });
  expect(role.status).toBe(201);
  const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  const session = await (
    await fetch(`${API}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: ANON_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
    })
  ).json();
  expect(session.access_token).toBeTruthy();
  return session.access_token;
}

/**
 * O gestor importa a lista, com o JWT dele: só HMACs saem do servidor (`importAllowlist` em
 * src/modules/access). A tela da importação é da #26; quando ela entrar, este passo pode ir
 * para a interface.
 */
async function importAllowlist(managerToken: string, emails: string[]): Promise<{ received: number; promoted: number }> {
  const res = await fetch(`${API}/rest/v1/rpc/import_allowlist`, {
    method: "POST",
    headers: { apikey: ANON_KEY!, Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_email_hmacs: emails.map(emailHmac), p_source: "manual" }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function latestLink(request: APIRequestContext, to: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
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

/** Pede o link em /entrar, abre o e-mail no Mailpit e clica em "Entrar". */
async function signInByEmail(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const at = Date.now() - 1000;
  await page.goto("/entrar");
  await page.getByLabel("Seu e-mail").fill(email);
  // Turnstile (#116) com a chave de teste que sempre passa.
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", { timeout: 20_000 });
  await page.getByRole("button", { name: "Receber link por e-mail" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(/Se este e-mail puder entrar/);
  await page.goto(await latestLink(request, email, at));
  await page.getByRole("button", { name: "Entrar" }).click();
}

let managerToken = "";

test.beforeAll(async () => {
  managerToken = await createRootManager();
});

test("pessoa autorizada: link mágico → perfil → casa → contato → meus dados → excluir conta", async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000);
  const person = { email: `fluxo.ok.${run}@exemplo.org`, name: "Pessoa Fluxo Completo", phone: `11 9${String(run).slice(-8)}` };
  expect(await importAllowlist(managerToken, [person.email])).toEqual({ received: 1, promoted: 0 });

  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await signInByEmail(page, request, person.email);

  // Perfil (#12): sem perfil, o login leva ao formulário. Na lista, salvar libera o acesso.
  await acceptTermIfAsked(page);
  await expect(page).toHaveURL(`${baseURL}/perfil`);
  await expect(page.getByTestId("connected-as")).toHaveText("Conectado como fl***@e***.org");
  await page.getByLabel("Seu nome").fill(person.name);
  await page.getByLabel("Seu WhatsApp, com DDD").fill(person.phone);
  await page.getByLabel("Sua cidade").selectOption({ label: "São Paulo" });
  await page.getByLabel("Seu distrito").selectOption("Sé");
  await page.getByRole("button", { name: "Salvar meus dados" }).click();
  await expect(page).toHaveURL(`${baseURL}/inicio?salvo=1`);
  await expect(page.getByRole("main").getByRole("status")).toBeVisible();
  // O id da conta, pelo Auth (gerar um link novo depois do login não muda a sessão aberta).
  const { id } = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: person.email }) })).json();
  expect(await rows(`profiles?id=eq.${id}&select=access_status`)).toEqual([{ access_status: "active" }]);
  // Liberada na hora, sem passar pela espera; o e-mail nunca aparece inteiro.
  expect(await rows(`access_waitlist_hmac?profile_id=eq.${id}&select=profile_id`)).toEqual([]);
  await expect(page.locator("body")).not.toContainText(person.email);

  // Casa (#76/#135): sabe qual quer, conhece e aceita.
  await page.getByRole("link", { name: "Escolher sua casa" }).click();
  await expect(page).toHaveURL(`${baseURL}/casa`);
  await page.getByRole("button", { name: "Sim, já sei" }).click();
  await page.getByRole("button", { name: "[PREENCHER] Atividade exemplo 2A" }).click();
  await expect(page.getByTestId("house-name")).toHaveText("Casa Exemplo Dois");
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Sua casa", { exact: true })).toBeVisible();

  // Quem vê o contato (#119): da coordenação (padrão) para equipe e casa.
  await page.goto("/inicio");
  await page.getByRole("link", { name: "Quem vê meu contato" }).click();
  await expect(page).toHaveURL(`${baseURL}/perfil/contato`);
  const whatsapp = page.getByRole("group", { name: "Seu WhatsApp" });
  await expect(whatsapp.getByRole("button", { name: "Só a coordenação", exact: true })).toHaveAttribute("aria-pressed", "true");
  await whatsapp.getByRole("button", { name: "Minha equipe e minha casa", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/perfil/contato?escolha=salva`);
  await expect(whatsapp.getByRole("button", { name: "Minha equipe e minha casa", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Baixar meus dados (#20): o arquivo tem tudo o que ela fez acima, decifrado.
  await page.goto("/inicio");
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar meus dados" }).click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(data.conta.emailDeLogin).toBe(person.email);
  expect(data.perfil).toMatchObject({ nome: person.name, municipio: { nome: "São Paulo", uf: "SP" }, liberacaoDeAcesso: "active" });
  expect(data.contato).toMatchObject({ whatsapp: `+55${person.phone.replace(/\D/g, "")}` });
  expect(data.casas).toEqual([expect.objectContaining({ casa: "Casa Exemplo Dois", formaDeEntrada: "self", saiuEm: null })]);
  expect(data.registrosSobreVoce.map((r: { evento: string }) => r.evento)).toEqual(expect.arrayContaining(["house_accepted", "data_exported"]));

  // Excluir a conta (#18): some do Auth e do banco; a sessão acaba.
  await page.getByRole("link", { name: "Excluir minha conta" }).click();
  await expect(page).toHaveURL(`${baseURL}/excluir-conta`);
  await page.getByLabel(/escreva EXCLUIR/).fill("EXCLUIR");
  await page.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
  await expect(page).toHaveURL(`${baseURL}/conta-excluida`);
  expect((await admin(`/auth/v1/admin/users/${id}`)).status).toBe(404);
  expect(await rows(`profiles?id=eq.${id}&select=id`)).toEqual([]);
  expect(await rows(`profile_contacts?profile_id=eq.${id}&select=profile_id`)).toEqual([]);
  expect(await rows(`house_members?profile_id=eq.${id}&select=id`)).toEqual([]);
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/entrar\?next=%2Finicio$/);
  await page.context().close();
});

test("pessoa fora da lista: espera até o gestor importar o e-mail dela", async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  const person = { email: `fluxo.espera.${run}@exemplo.org`, name: "Pessoa Fluxo Espera", phone: `11 9${String(run + 1).slice(-8)}` };
  const page = await (await browser.newContext()).newPage();
  await signInByEmail(page, request, person.email);

  await acceptTermIfAsked(page);

  await expect(page).toHaveURL(`${baseURL}/perfil`);
  await page.getByLabel("Seu nome").fill(person.name);
  await page.getByLabel("Seu WhatsApp, com DDD").fill(person.phone);
  await page.getByLabel("Sua cidade").selectOption({ label: "Osasco" });
  await page.getByRole("button", { name: "Salvar meus dados" }).click();
  await expect(page).toHaveURL(`${baseURL}/espera`);
  await expect(page.locator("body")).not.toContainText(person.name);

  // Na espera, a área logada continua fechada.
  for (const path of ["/inicio", "/casa", "/perfil/contato"]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${baseURL}/espera`);
  }
  // Na espera, o banco guarda só o HMAC do e-mail (a próxima importação com ele libera).
  const [waiting] = (await rows(`access_waitlist_hmac?email_hmac=eq.${emailHmac(person.email)}&select=profile_id`)) as { profile_id: string }[];
  const id = waiting!.profile_id;

  // Sem a sessão do gestor da raiz, a importação é recusada.
  const denied = await fetch(`${API}/rest/v1/rpc/import_allowlist`, {
    method: "POST",
    headers: { apikey: ANON_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ p_email_hmacs: [emailHmac(person.email)], p_source: "manual" }),
  });
  expect(denied.ok).toBe(false);
  await page.goto("/inicio");
  await expect(page).toHaveURL(`${baseURL}/espera`);

  // O gestor importa o e-mail: a pessoa é liberada na hora, com o registro do motivo.
  expect(await importAllowlist(managerToken, [person.email])).toEqual({ received: 1, promoted: 1 });
  expect(await rows(`access_waitlist_hmac?profile_id=eq.${id}&select=profile_id`)).toEqual([]);
  expect(await rows(`audit_log?target_id=eq.${id}&event=eq.access_granted&select=reason`)).toEqual([{ reason: "import" }]);
  await page.goto("/inicio");
  await expect(page).toHaveURL(`${baseURL}/inicio`);
  await expect(page.getByRole("link", { name: "Escolher sua casa" })).toBeVisible();
  await page.context().close();
});
