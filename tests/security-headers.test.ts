// #68: o app envia os cabeçalhos de segurança em todas as rotas. #152: a CSP vem do proxy, com nonce.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { proxy } from "../src/proxy";

async function headersOfAllRoutes(): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const rule = rules.find((r) => r.source === "/:path*");
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
}

describe("cabeçalhos de segurança", () => {
  it("valem para todas as rotas", async () => {
    expect(Object.keys(await headersOfAllRoutes()).length).toBeGreaterThan(0);
  });

  it("barram sniffing de tipo e embutir o app em outro site", async () => {
    const headers = await headersOfAllRoutes();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("limitam referrer e recursos do aparelho", async () => {
    const headers = await headersOfAllRoutes();
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("exigem HTTPS por pelo menos 6 meses", async () => {
    const headers = await headersOfAllRoutes();
    const maxAgeSeconds = Number(/max-age=(\d+)/.exec(headers["Strict-Transport-Security"] ?? "")?.[1]);
    expect(maxAgeSeconds).toBeGreaterThanOrEqual(15_552_000);
  });

  it("não anunciam o framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("CSP com nonce no proxy (#152)", () => {
  afterEach(() => {
    delete process.env.CSP_REPORT_ONLY;
  });

  it("não é fixa no next.config: vem do proxy, com nonce novo a cada requisição, até no redirecionamento", async () => {
    // Arrange
    const fixed = (await headersOfAllRoutes())["Content-Security-Policy"];

    // Act
    const first = await proxy(new NextRequest("http://127.0.0.1/entrar"));
    const second = await proxy(new NextRequest("http://127.0.0.1/entrar"));
    const redirect = await proxy(new NextRequest("http://127.0.0.1/inicio"));
    const csp = first.headers.get("Content-Security-Policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];

    // Assert
    expect(fixed).toBeUndefined();
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/_-]+={0,2}' 'strict-dynamic'/);
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(second.headers.get("Content-Security-Policy")).not.toBe(csp);
    expect(redirect.headers.get("location")).toContain("/entrar");
    expect(redirect.headers.get("Content-Security-Policy")).toContain("'strict-dynamic'");
    // O Next lê o nonce do cabeçalho da REQUISIÇÃO repassada à página (x-middleware-request-*).
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("CSP_REPORT_ONLY=1 só avisa (para testar no staging antes de bloquear)", async () => {
    // Arrange
    process.env.CSP_REPORT_ONLY = "1";

    // Act
    const response = await proxy(new NextRequest("http://127.0.0.1/entrar"));

    // Assert
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("Content-Security-Policy-Report-Only") ?? "").toContain("'strict-dynamic'");
  });

  it.each([
    ["só aviso", "1", "Content-Security-Policy"],
    ["bloqueando", undefined, "Content-Security-Policy-Report-Only"],
  ])("%s: cabeçalho de CSP vindo do cliente não chega à página (o Next leria dele o nonce errado)", async (_mode, reportOnly, spoofed) => {
    // Arrange: o Next tira o nonce do Content-Security-Policy da requisição e, sem ele, do Report-Only.
    if (reportOnly) process.env.CSP_REPORT_ONLY = reportOnly;
    const request = new NextRequest("http://127.0.0.1/entrar", { headers: { [spoofed]: "script-src 'nonce-forjado'" } });

    // Act
    const response = await proxy(request);
    const forwarded = response.headers.get(`x-middleware-request-${spoofed.toLowerCase()}`);

    // Assert
    expect(forwarded).toBeNull();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it("o compose do app repassa CSP_REPORT_ONLY (estreia só avisando no staging), e o padrão é bloquear", () => {
    // Arrange: o container só recebe as variáveis listadas em `environment:`.
    const compose = readFileSync(join(process.cwd(), "deploy", "docker-compose.app.yml"), "utf8");
    const envExample = readFileSync(join(process.cwd(), "deploy", "env.example"), "utf8");

    // Act
    const line = /^\s+CSP_REPORT_ONLY: \$\{CSP_REPORT_ONLY:-([^}]*)\}$/m.exec(compose);

    // Assert
    expect(line).not.toBeNull();
    expect(line?.[1]).toBe("");
    expect(envExample).toMatch(/^CSP_REPORT_ONLY=$/m);
  });

  it("nenhuma página sai pronta do build: página estática não recebe nonce e teria os scripts bloqueados", () => {
    // Arrange
    const layout = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8");

    // Act / Assert
    expect(layout).toMatch(/await connection\(\)/);
  });
});
