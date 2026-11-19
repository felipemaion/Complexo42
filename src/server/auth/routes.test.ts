import { describe, expect, it } from "vitest";
import { decideRoute, HOME_PATH, isPublicPath, safeNextPath } from "./routes";

describe("decideRoute (#9)", () => {
  it("sem sessão, rota protegida vai para /entrar guardando o destino", () => {
    expect(decideRoute("/inicio", "?a=1", false)).toEqual({ action: "redirect", to: "/entrar?next=%2Finicio%3Fa%3D1" });
  });

  it("negado por padrão: rota desconhecida também exige sessão", () => {
    expect(decideRoute("/qualquer/coisa", "", false).action).toBe("redirect");
  });

  it("rotas públicas seguem sem sessão", () => {
    for (const path of ["/", "/entrar", "/entrar/", "/auth/callback"]) expect(decideRoute(path, "", false)).toEqual({ action: "next" });
  });

  it("com sessão, /entrar vai para a página inicial e as demais seguem", () => {
    expect(decideRoute("/entrar", "", true)).toEqual({ action: "redirect", to: HOME_PATH });
    expect(decideRoute("/inicio", "", true)).toEqual({ action: "next" });
  });

  it("não confunde prefixo com rota pública", () => {
    expect(isPublicPath("/entrarx")).toBe(false);
    expect(isPublicPath("/auth/callback/extra")).toBe(false);
  });
});

describe("safeNextPath (#9): sem redirecionamento aberto", () => {
  it("aceita caminho interno com query", () => {
    expect(safeNextPath("/inicio?aba=2")).toBe("/inicio?aba=2");
  });

  it.each([
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
