import { expect, test } from "@playwright/test";
import { giveHouse } from "./give-house";

// Navegação de volta das páginas logadas (#205). Sem Supabase (o CI) não há o que abrir: todas
// exigem sessão. Com o Supabase local, pessoa ativa e gestora da raiz abrem cada página por link
// direto (sem histórico) e voltam ao início só com os links do cabeçalho. Para rodar (stack local
// de pé, `site_url` do supabase/config.toml apontando para a porta do E2E):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> \
//   E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY do `supabase status`> npm run test:e2e -- e2e/navigation-live.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo de teste; o app e o navegador nunca a recebem (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY ?? process.env.E2E_LIVE_SERVICE_ROLE_KEY;
const LIVE = Boolean(API && process.env.E2E_LIVE_ANON_KEY && SERVICE_KEY);

test("sem sessão, as páginas logadas mandam para o login", async ({ page }) => {
  for (const path of ["/casa", "/perfil", "/coordenacao/casas/resultados"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/entrar\\?next=${encodeURIComponent(path)}$`));
  }
});

test.describe("navegação com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local e das chaves locais (ver o topo do arquivo)");

  const run = Date.now();
  const SAO_PAULO = 3550308;

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  /** Gestora da raiz, ativa e com o termo aceito; entra pelo link mágico num navegador novo. */
  async function signedInManager(browser: import("@playwright/test").Browser) {
    const email = `nav.${run}@exemplo.org`;
    const user = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, email_confirm: true }) })).json();
    const created = await admin("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: user.id,
        display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
        municipality_code: SAO_PAULO,
        consent_version: "v1",
        access_status: "active",
        status: "active",
      }),
    });
    expect(created.status).toBe(201);
    await giveHouse(admin, user.id);
    const consent = await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, version: "v1" }) });
    expect(consent.status).toBe(201);
    const [unit] = await (await admin("/rest/v1/units?parent_id=is.null&select=id")).json();
    const role = await admin("/rest/v1/role_assignments", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ profile_id: user.id, role: "manager", unit_id: unit.id }) });
    expect(role.status).toBe(201);
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
    return page;
  }

  test("de /casa, /perfil e da coordenação dá para voltar ao início, mesmo por link direto", async ({ browser, baseURL }) => {
    const page = await signedInManager(browser);
    await expect(page).toHaveURL(`${baseURL}/inicio`);
    const nav = page.getByRole("navigation", { name: "Navegação da conta" });
    // Na página inicial há "Início", mas não há "Voltar".
    await expect(nav.getByRole("link", { name: "Início" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Voltar" })).toHaveCount(0);

    for (const path of ["/casa", "/perfil"]) {
      await page.goto(path);
      await nav.getByRole("link", { name: "Voltar" }).click();
      await expect(page).toHaveURL(`${baseURL}/inicio`);
    }

    // Coordenação: cada "Voltar" sobe um nível; "Início" salta direto.
    await page.goto("/coordenacao/casas/resultados");
    await nav.getByRole("link", { name: "Voltar" }).click();
    await expect(page).toHaveURL(`${baseURL}/coordenacao`);
    await nav.getByRole("link", { name: "Voltar" }).click();
    await expect(page).toHaveURL(`${baseURL}/inicio`);

    await page.goto("/coordenacao/espera");
    await nav.getByRole("link", { name: "Início" }).click();
    await expect(page).toHaveURL(`${baseURL}/inicio`);
  });
});
