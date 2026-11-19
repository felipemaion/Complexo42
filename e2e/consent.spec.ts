import { expect, test } from "@playwright/test";

// Termo de consentimento (#11). Sem Supabase (o CI sem banco): só a proteção da rota. Com o
// Supabase local, o fluxo real: quem não aceitou cai no termo (também ao tentar abrir outra
// página), a caixa vem desmarcada, o botão só habilita depois de marcar, o aceite fica gravado
// na conta (`consent_acceptances`) e no perfil (`consent_version`, `consent_at`), e sem o aceite da versão vigente volta ao termo. Para rodar (stack
// local de pé, `site_url` do supabase/config.toml apontando para a porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY do `supabase status`> npm run test:e2e -- e2e/consent.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste; o app nunca a recebe (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY;
const LIVE = Boolean(API && process.env.E2E_LIVE_ANON_KEY && SERVICE_KEY);

test("sem sessão, o termo manda para o login", async ({ page }) => {
  await page.goto("/termo");
  await expect(page).toHaveURL(/\/entrar\?next=%2Ftermo$/);
});

test.describe("termo com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e das chaves locais (ver o topo do arquivo)");

  const run = Date.now();
  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  test("sem aceite → termo; caixa desmarcada e botão desabilitado; aceitar leva ao perfil e grava a versão", async ({ browser, baseURL }) => {
    const email = `termo.${run}@exemplo.org`;
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();

    // Sem aceite, o login leva ao termo; outra página também volta para ele.
    await expect(page).toHaveURL(`${baseURL}/termo`);
    await page.goto("/perfil");
    await expect(page).toHaveURL(`${baseURL}/termo`);

    // Os direitos do titular valem sem aceite: baixar os dados e chegar à exclusão da conta.
    await expect(page.getByRole("button", { name: "Baixar meus dados" })).toBeVisible();
    const download = await page.request.post("/meus-dados", { headers: { origin: baseURL! } });
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    await page.getByRole("link", { name: "Excluir minha conta" }).click();
    await expect(page).toHaveURL(`${baseURL}/excluir-conta`);
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}/termo`);

    // Letra grande, caixa desmarcada, botão desabilitado até marcar.
    const term = page.getByTestId("consent-term");
    await expect(term.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await term.locator("p").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
    const checkbox = page.getByRole("checkbox");
    const next = page.getByRole("button", { name: "Continuar" });
    await expect(checkbox).not.toBeChecked();
    await expect(next).toBeDisabled();
    await checkbox.check();
    await expect(next).toBeEnabled();
    await checkbox.uncheck();
    await expect(next).toBeDisabled();
    await checkbox.check();
    await next.click();

    // Sem perfil ainda: o aceite já está gravado na conta e segue ao formulário.
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    expect(await (await admin(`/rest/v1/consent_acceptances?user_id=eq.${link.id}&select=version`)).json()).toEqual([{ version: "v1" }]);
    await page.getByLabel("Seu nome").fill("Pessoa do Termo");
    await page.getByLabel("Seu WhatsApp, com DDD").fill(`11 9${String(run).slice(-8)}`);
    await page.getByLabel("Sua cidade").selectOption({ label: "Osasco" });
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await page.waitForURL((url) => url.pathname !== "/perfil");

    const rows = await (await admin(`/rest/v1/profiles?id=eq.${link.id}&select=consent_version,consent_at`)).json();
    expect(rows).toEqual([{ consent_version: "v1", consent_at: expect.any(String) }]);
    const audit = await (await admin(`/rest/v1/audit_log?actor_id=eq.${link.id}&event=eq.consent_accepted&select=term_version`)).json();
    expect(audit).toEqual([{ term_version: "v1" }]);

    // Liberada, como a coordenação faria (fora da lista, o cadastro cai na espera).
    await admin(`/rest/v1/profiles?id=eq.${link.id}`, { method: "PATCH", body: JSON.stringify({ access_status: "active", status: "active" }) });

    // Termo aceito: a página do termo não é mais obstáculo.
    await page.goto("/termo");
    await expect(page).not.toHaveURL(`${baseURL}/termo`);

    // Sem o aceite da versão vigente (simulado: a linha some), o portão manda para o termo.
    await admin(`/rest/v1/consent_acceptances?user_id=eq.${link.id}`, { method: "DELETE" });
    await page.goto("/inicio");
    await expect(page).toHaveURL(`${baseURL}/termo`);
    await page.context().close();
  });
});
