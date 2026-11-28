import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { giveHouse } from "./give-house";

// Acessibilidade e espaço da tela (#324): WCAG 2.2 AA pelo axe, nos temas claro e escuro do sistema, no
// celular (390 px) e no computador (1440 px), e sem rolagem horizontal. As páginas públicas rodam sempre
// (o CI também); as logadas, com o Supabase local (ver o topo de e2e/navigation-live.spec.ts).
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SCHEMES = ["light", "dark"] as const;
const WIDTHS = [390, 1440];

async function expectAccessible(page: Page, where: string, scope?: string): Promise<void> {
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const label = `${where} (${colorScheme}, ${width}px)`;
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `rolagem horizontal em ${label}`).toBeLessThanOrEqual(0);
      // O widget anti-robô (Turnstile, #116) é da Cloudflare, num iframe: fora do nosso alcance.
      const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude("iframe");
      const { violations } = await (scope ? builder.include(scope) : builder).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
    }
  }
}

for (const path of ["/", "/entrar", "/conta-excluida"]) {
  test(`${path} passa no axe nos dois temas, sem rolagem horizontal`, async ({ page }) => {
    await page.goto(path);
    await expectAccessible(page, path);
  });
}

test.describe("páginas logadas com o Supabase local", () => {
  const API = process.env.E2E_LIVE_SUPABASE_URL;
  const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY ?? process.env.E2E_LIVE_SERVICE_ROLE_KEY;
  test.skip(!API || !process.env.E2E_LIVE_ANON_KEY || !SERVICE_KEY, "precisa do Supabase local e das chaves locais");

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });

  /** Gestora da raiz, ativa, com casa e termo aceito (mesmo preparo de e2e/navigation-live.spec.ts). */
  async function signedInManager(browser: Browser): Promise<Page> {
    const email = `a11y.${Date.now()}@exemplo.org`;
    const user = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, email_confirm: true }) })).json();
    const created = await admin("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: user.id,
        display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
        municipality_code: 3550308,
        consent_version: "v1",
        access_status: "active",
        status: "active",
      }),
    });
    expect(created.status).toBe(201);
    await giveHouse(admin, user.id);
    await admin("/rest/v1/consent_acceptances", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, version: "v1" }) });
    const [unit] = await (await admin("/rest/v1/units?parent_id=is.null&select=id")).json();
    await admin("/rest/v1/role_assignments", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ profile_id: user.id, role: "manager", unit_id: unit.id }) });
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
    return page;
  }

  test("o cabeçalho das páginas logadas passa no axe nos dois temas, sem rolagem horizontal", async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await signedInManager(browser);
    await page.goto("/coordenacao");
    // Só o cabeçalho, que é o que a base da #324 muda; as páginas entram nos PRs de cada grupo.
    await expectAccessible(page, "cabeçalho", "header");
  });
});
