import { expect, test, type Page } from "@playwright/test";

// CSP com nonce (#152) no navegador de verdade. O teste unitário (src/server/csp.test.ts) garante o
// cabeçalho; aqui, que as páginas continuam funcionando com ele: todo <script> que o servidor manda
// leva o nonce da resposta, o widget do Turnstile carrega o script e o iframe dele, e o navegador
// não bloqueia nada. Turnstile falso, como em e2e/auth.spec.ts: o teste não depende da rede.
const TURNSTILE = "https://challenges.cloudflare.com";

async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

function nonceOf(csp: string): string {
  return /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
}

test.describe("CSP com nonce (#152)", () => {
  test("/entrar: scripts com o nonce da resposta, Turnstile carrega script e iframe, nada bloqueado", async ({ page }) => {
    // Arrange: o script falso abre um iframe da origem da Cloudflare, como o de verdade.
    await page.route(`${TURNSTILE}/turnstile/v0/api.js**`, (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.turnstile = {
          render(el) {
            const frame = document.createElement("iframe");
            frame.src = "${TURNSTILE}/cdn-cgi/challenge-platform/e2e";
            el.append(frame);
            return "w1";
          },
          remove() {},
        };`,
      }),
    );
    await page.route(`${TURNSTILE}/cdn-cgi/challenge-platform/**`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>desafio</p>" }),
    );
    const violations = await watchViolations(page);

    // Act
    const response = await page.goto("/entrar");
    const html = (await response?.text()) ?? "";
    const nonce = nonceOf((await response?.allHeaders())?.["content-security-policy"] ?? "");
    const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];

    // Assert
    expect(nonce).not.toBe("");
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) expect(tag).toContain(`nonce="${nonce}"`);
    await expect(page.frameLocator("[data-turnstile] iframe").getByText("desafio")).toBeVisible();
    expect(await violations()).toEqual([]);
  });

  test("páginas públicas sem login abrem sem nada bloqueado e com nonce novo a cada visita", async ({ page }) => {
    // Arrange
    const violations = await watchViolations(page);

    for (const path of ["/", "/espera", "/conta-excluida"]) {
      // Act
      const first = await page.goto(path);
      await page.waitForLoadState("networkidle");
      const again = await page.request.get(path);

      // Assert
      expect(first?.status(), path).toBe(200);
      const nonce = nonceOf((await first?.allHeaders())?.["content-security-policy"] ?? "");
      expect(nonce, path).not.toBe("");
      expect(nonceOf(again.headers()["content-security-policy"] ?? ""), path).not.toBe(nonce);
      expect(await violations(), path).toEqual([]);
    }
  });
});
