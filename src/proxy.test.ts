import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

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

describe("proxy(): credencial na URL nunca vai para a resposta (Location)", () => {
  const location = async (url: string) => {
    const response = await proxy(new NextRequest(url));
    return { status: response.status, to: response.headers.get("location") ?? "" };
  };

  it("/verify antigo (token na query) vira /entrar sem query, com o aviso de link antigo", async () => {
    const out = await location("http://localhost/verify?token=segredo123&type=magiclink");
    expect(out.status).toBe(307);
    expect(out.to).toBe("http://localhost/entrar?erro=legacy_link");
    expect(out.to).not.toContain("segredo123");
  });

  it("rota desconhecida e protegida guarda só o caminho em next; token, code e sessão ficam de fora", async () => {
    for (const query of ["token=segredo123", "code=abc", "access_token=a&refresh_token=b", "token_hash=h&type=recovery"]) {
      const out = await location(`http://localhost/qualquer/coisa?${query}`);
      expect(out.to, query).toBe("http://localhost/entrar?next=%2Fqualquer%2Fcoisa");
    }
  });

  it("/entrar com token na query é limpo", async () => {
    const out = await location("http://localhost/entrar?token=segredo123&type=magiclink");
    expect(out.to).toBe("http://localhost/entrar?erro=legacy_link");
  });
});
