import { describe, expect, it } from "vitest";
import { decideRoute, HOME_PATH, isPublicPath, needsNoStore, safeNextPath, waitlistPageTarget, WAITLIST_PATH } from "./routes";

describe("decideRoute (#9)", () => {
  it("sem sessão, rota protegida vai para /entrar guardando o destino", () => {
    expect(decideRoute("/inicio", "?a=1", false)).toEqual({ action: "redirect", to: "/entrar?next=%2Finicio%3Fa%3D1" });
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
  it("aceita caminho interno com query", () => {
    expect(safeNextPath("/inicio?aba=2")).toBe("/inicio?aba=2");
  });

  it("normaliza caminho interno e é idempotente", () => {
    expect(safeNextPath("/a/../inicio")).toBe("/inicio");
    expect(safeNextPath("/ação?x=ç")).toBe("/a%C3%A7%C3%A3o?x=%C3%A7");
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
