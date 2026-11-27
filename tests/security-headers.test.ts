// #68: o app envia os cabeçalhos de segurança em todas as rotas.
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
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

  it("a CSP não é fixa aqui: vem do proxy, com nonce novo a cada requisição (#152)", async () => {
    // Arrange
    const fixed = (await headersOfAllRoutes())["Content-Security-Policy"];

    // Act
    const first = await proxy(new NextRequest("http://127.0.0.1/entrar"));
    const second = await proxy(new NextRequest("http://127.0.0.1/entrar"));
    const redirect = await proxy(new NextRequest("http://127.0.0.1/inicio"));
    const csp = first.headers.get("Content-Security-Policy") ?? "";

    // Assert
    expect(fixed).toBeUndefined();
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/_-]+={0,2}' 'strict-dynamic'/);
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(second.headers.get("Content-Security-Policy")).not.toBe(csp);
    // Até o redirecionamento para o login leva a CSP.
    expect(redirect.headers.get("location")).toContain("/entrar");
    expect(redirect.headers.get("Content-Security-Policy")).toContain("'strict-dynamic'");
  });

  it("não anunciam o framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
