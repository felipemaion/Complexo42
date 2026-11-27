import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// O matcher decide o que passa pelo proxy de login. Arquivos públicos (imagens, ícones, healthz) não
// podem ser redirecionados para /entrar: o logo da própria página de entrada e o favicon carregam sem sessão.
const guarded = new RegExp(`^${config.matcher[0]}$`);
const passesThroughProxy = (path: string) => guarded.test(path);

describe("matcher do proxy de login", () => {
  it("não intercepta arquivos públicos: estáticos do Next, favicon, healthz, imagens das casas e ícones do app", () => {
    for (const path of [
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/favicon.ico",
      "/api/healthz",
      "/casas/app-logo-128.webp",
      "/casas/outra-512.png",
      "/icon.png",
      "/apple-icon.png",
    ]) {
      expect(passesThroughProxy(path), path).toBe(false);
    }
  });

  it("continua protegendo as páginas e o que só parece público", () => {
    for (const path of ["/inicio", "/casa", "/entrar", "/coordenacao", "/casas", "/casas-x/a.png", "/icon.png.x", "/api/healthz-x", "/favicon.ico.x"]) {
      expect(passesThroughProxy(path), path).toBe(true);
    }
  });
});
