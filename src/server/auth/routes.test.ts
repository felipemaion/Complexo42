import { describe, expect, it } from "vitest";
import { decideRoute, hasCredentialQuery, HOME_PATH, isPublicPath, needsNoStore, safeNextPath, waitlistPageTarget, WAITLIST_PATH } from "./routes";

describe("decideRoute (#9)", () => {
  it("sem sessão, rota protegida vai para /entrar guardando só o CAMINHO (nunca a query)", () => {
    expect(decideRoute("/inicio", "", false)).toEqual({ action: "redirect", to: "/entrar?next=%2Finicio" });
    expect(decideRoute("/inicio", "?a=1", false)).toEqual({ action: "redirect", to: "/entrar?next=%2Finicio" });
  });

  it("credencial na query nunca é copiada para o /entrar (token de uso único, code, tokens de sessão)", () => {
    for (const search of ["?token=segredo&type=magiclink", "?code=abc", "?access_token=a&refresh_token=b", "?token_hash=h&type=recovery"]) {
      const decision = decideRoute("/qualquer/coisa", search, false);
      expect(decision).toEqual({ action: "redirect", to: "/entrar?next=%2Fqualquer%2Fcoisa" });
      expect(JSON.stringify(decision)).not.toMatch(/segredo|abc|token|code/);
    }
  });

  it("caminhos antigos de link (/verify, /callback, ...) viram /entrar sem query, com o aviso de link antigo, logado ou não", () => {
    for (const path of ["/verify", "/verify/", "/callback", "/auth/v1/verify", "/auth/verify"]) {
      for (const authenticated of [false, true]) {
        expect(decideRoute(path, "?token=segredo&type=magiclink", authenticated), `${path} ${authenticated}`).toEqual({
          action: "redirect",
          to: "/entrar?erro=legacy_link",
        });
      }
    }
  });

  it("/entrar com credencial na query é limpo (a URL com o token não fica no histórico nem no log)", () => {
    expect(decideRoute("/entrar", "?token=segredo", false)).toEqual({ action: "redirect", to: "/entrar?erro=legacy_link" });
    expect(decideRoute("/entrar", "?code=abc&next=%2Finicio", false)).toEqual({ action: "redirect", to: "/entrar?erro=legacy_link" });
    expect(decideRoute("/entrar", "?next=%2Finicio", false)).toEqual({ action: "next" });
  });

  it("negado por padrão: rota desconhecida também exige sessão", () => {
    expect(decideRoute("/qualquer/coisa", "", false).action).toBe("redirect");
  });

  it("rotas públicas seguem sem sessão", () => {
    for (const path of ["/", "/entrar", "/entrar/", "/auth/callback", "/auth/confirmar", "/auth/sair", "/espera", "/conta-excluida"]) expect(decideRoute(path, "", false)).toEqual({ action: "next" });
  });

  it("com sessão, /entrar vai para a página inicial e as demais seguem", () => {
    expect(decideRoute("/entrar", "", true)).toEqual({ action: "redirect", to: HOME_PATH });
    expect(decideRoute("/inicio", "", true)).toEqual({ action: "next" });
  });

  it("não confunde prefixo com rota pública", () => {
    expect(isPublicPath("/entrarx")).toBe(false);
    expect(isPublicPath("/auth/callback/extra")).toBe(false);
    // A página da exclusão (#18) exige sessão; só a despedida é pública.
    expect(isPublicPath("/excluir-conta")).toBe(false);
  });
});

describe("safeNextPath (#9): sem redirecionamento aberto", () => {
  it("aceita caminho interno e descarta a query (nada de credencial no destino)", () => {
    expect(safeNextPath("/inicio?aba=2")).toBe("/inicio");
    expect(safeNextPath("/x?token=segredo&type=magiclink")).toBe("/x");
    expect(safeNextPath("/inicio#token=abc")).toBe("/inicio");
  });

  it("normaliza caminho interno e é idempotente", () => {
    expect(safeNextPath("/a/../inicio")).toBe("/inicio");
    expect(safeNextPath("/ação?x=ç")).toBe("/a%C3%A7%C3%A3o");
    for (const raw of ["/inicio?aba=2", "/a/../b", "/ação", "/.//mal.example", "/%2e//x", "/a b"]) {
      const once = safeNextPath(raw);
      expect(safeNextPath(once)).toBe(once);
    }
  });

  it("barras unicode parecidas com `/` ficam como caminho interno codificado", () => {
    for (const raw of ["/\u2215/mal.example", "/\uff0f/mal.example", "/\u2044mal.example"]) {
      const out = safeNextPath(raw);
      expect(out).toMatch(/^\/(?!\/)/);
      expect(new URL(out, "https://app.exemplo.org").origin).toBe("https://app.exemplo.org");
    }
  });

  it.each([
    // H1: caminhos que, normalizados, viram `//mal.example`.
    ["/.//mal.example"],
    ["/a/..//mal.example"],
    ["/%2e//mal.example"],
    ["/..//mal.example"],
    ["/%2E%2E//mal.example"],
    ["//x"],
    ["/\\x"],
    ["/%5cmal.example"],
    ["/%5Cmal.example"],
    ["/%09/mal.example"],
    ["/auth/confirmar?token_hash=x"],
    ["//mal.example/x"],
    ["/\\mal.example"],
    ["https://mal.example"],
    ["javascript:alert(1)"],
    ["/%0d%0aSet-Cookie:x".replace("%0d%0a", "\r\n")],
    ["inicio"],
    [""],
    [null],
    [["/inicio"]],
    ["/entrar"],
    ["/auth/callback?code=x"],
    ["/" + "a".repeat(600)],
  ])("recusa %j", (raw) => {
    expect(safeNextPath(raw)).toBe(HOME_PATH);
  });
});

describe("needsNoStore (#9, L3)", () => {
  it("login, rotas de auth e respostas que gravam cookie", () => {
    expect(needsNoStore("/entrar", false)).toBe(true);
    expect(needsNoStore("/auth/callback", false)).toBe(true);
    expect(needsNoStore("/inicio", true)).toBe(true);
    expect(needsNoStore("/", false)).toBe(false);
  });
});

describe("waitlistPageTarget (#195): quem abre /espera já liberado vai para dentro", () => {
  it("o portão de acesso deixou passar (ativo): vai para a página inicial, não fica na espera", () => {
    expect(waitlistPageTarget(null)).toBe(HOME_PATH);
  });

  it("o portão manda para a espera (ainda aguardando): fica na página", () => {
    expect(waitlistPageTarget(WAITLIST_PATH)).toBeNull();
  });

  it("bloqueado ou falha na checagem: segue o destino do portão (encerra a sessão)", () => {
    expect(waitlistPageTarget("/auth/sair?motivo=blocked")).toBe("/auth/sair?motivo=blocked");
    expect(waitlistPageTarget("/auth/sair?motivo=failed")).toBe("/auth/sair?motivo=failed");
  });
});

describe("hasCredentialQuery: lista central de parâmetros de credencial", () => {
  it("reconhece token, code, tokens de sessão e type de link mágico/recuperação, em qualquer caixa", () => {
    for (const search of ["?token=a", "?TOKEN=a", "?code=a", "?access_token=a", "?refresh_token=a", "?token_hash=a", "?id_token=a", "?type=magiclink", "?type=recovery", "?x=1&Type=MagicLink", "?error_description=x&token=a"]) {
      expect(hasCredentialQuery(search), search).toBe(true);
    }
  });

  it("não acusa parâmetro inofensivo nem query vazia", () => {
    for (const search of ["", "?", "?aba=2", "?casa=x&outra=1", "?type=filtro", "?next=%2Finicio", "?erro=failed"]) {
      expect(hasCredentialQuery(search), search).toBe(false);
    }
  });
});
