// #68: o app envia os cabeçalhos de segurança em todas as rotas.
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

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

  it("só embutem o Turnstile do login e a prévia do YouTube sem cookies (portfólio, #70)", async () => {
    // Arrange
    const csp = (await headersOfAllRoutes())["Content-Security-Policy"] ?? "";

    // Act
    const frameSrc = /frame-src ([^;]+)/.exec(csp)?.[1]?.trim().split(/\s+/) ?? [];

    // Assert
    expect(frameSrc.sort()).toEqual(["'self'", "https://challenges.cloudflare.com", "https://www.youtube-nocookie.com"]);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("não anunciam o framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
