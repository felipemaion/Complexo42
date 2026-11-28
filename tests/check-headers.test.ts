import { execFile } from "node:child_process";
import { createServer, type OutgoingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

// scripts/check-headers.sh (#86) contra um servidor de mentira: o que o app e o kong.yml devolvem hoje
// passa; cada defeito que a borda poderia ter reprova com a linha certa.
type Site = {
  page?: OutgoingHttpHeaders;
  cookie?: string | null;
  cors?: string;
  scanStatus?: number;
};

let nonceCount = 0;
const goodCsp = () =>
  `default-src 'self'; script-src 'self' 'nonce-n${++nonceCount}' 'strict-dynamic' https://challenges.cloudflare.com; ` +
  "style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; " +
  "base-uri 'self'; frame-ancestors 'none'";
const goodPage = (): OutgoingHttpHeaders => ({
  "content-security-policy": goodCsp(),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
});
const defined = (headers: OutgoingHttpHeaders) => Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));

let server: Server | undefined;
afterEach(() => server?.close());

async function serve(site: Site): Promise<string> {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/entrar") {
      // A CSP muda a cada requisição (nonce), a não ser que o caso a fixe.
      res.writeHead(200, defined(site.page ?? goodPage()));
    } else if (path === "/auth/google") {
      const cookie = site.cookie === undefined ? "sb-pkce=abc; Path=/; HttpOnly; SameSite=Lax" : site.cookie;
      res.writeHead(302, { location: "/auth/v1/authorize", ...(cookie ? { "set-cookie": cookie } : {}) });
    } else if (path === "/auth/v1/settings") {
      res.writeHead(502, site.cors ? { "access-control-allow-origin": site.cors } : {});
    } else {
      res.writeHead(site.scanStatus ?? 404);
    }
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function check(url: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("bash", ["scripts/check-headers.sh", url], (err, stdout, stderr) =>
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

describe("scripts/check-headers.sh", () => {
  it("passa com os cabeçalhos de hoje", async () => {
    const { code, out } = await check(await serve({}));
    expect(out).not.toContain("ERRO");
    expect(out).toContain("nonce novo a cada requisição");
    expect(code).toBe(0);
  });

  it.each<[string, () => Site, RegExp]>([
    ["CSP só em Report-Only", () => ({ page: { ...goodPage(), "content-security-policy": undefined, "content-security-policy-report-only": goodCsp() } }), /Report-Only/],
    ["CSP sem object-src", () => ({ page: { ...goodPage(), "content-security-policy": "default-src 'self'; script-src 'nonce-x'" } }), /CSP sem object-src 'none'/],
    ["CSP com unsafe-eval", () => ({ page: { ...goodPage(), "content-security-policy": goodCsp().replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-eval'") } }), /unsafe-eval/],
    ["nonce fixo", () => ({ page: { ...goodPage(), "content-security-policy": goodCsp().replace(/nonce-n\d+/, "nonce-fixo") } }), /nonce se repete/],
    ["sem Permissions-Policy", () => ({ page: { ...goodPage(), "permissions-policy": undefined } }), /Permissions-Policy sem camera/],
    ["X-Frame-Options trocado", () => ({ page: { ...goodPage(), "x-frame-options": "SAMEORIGIN" } }), /x-frame-options é 'SAMEORIGIN'/],
    ["X-Powered-By", () => ({ page: { ...goodPage(), "x-powered-by": "Next.js" } }), /X-Powered-By presente/],
    ["cookie sem HttpOnly", () => ({ cookie: "sb-pkce=abc; Path=/; SameSite=Lax" }), /cookie sb-pkce sem HttpOnly/],
    ["cookie sem SameSite", () => ({ cookie: "sb-pkce=abc; Path=/; HttpOnly" }), /cookie sb-pkce sem SameSite=Lax/],
    ["Google sem cookie", () => ({ cookie: null }), /não pôs cookie/],
    ["CORS aberto no Auth", () => ({ cors: "*" }), /Access-Control-Allow-Origin: \*/],
    ["varredura achando arquivo", () => ({ scanStatus: 200 }), /\/\.env -> 200/],
  ])("reprova: %s", async (_name, site, message) => {
    const { code, out } = await check(await serve(site()));
    expect(out).toMatch(message);
    expect(code).toBe(1);
  });
});
