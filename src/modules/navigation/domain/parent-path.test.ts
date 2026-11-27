import { describe, expect, it } from "vitest";
import { parentPath } from "./parent-path";

describe("parentPath", () => {
  it("a página inicial não tem página-mãe", () => {
    expect(parentPath("/inicio")).toBeNull();
  });

  it("páginas de primeiro nível voltam ao início", () => {
    expect(parentPath("/casa")).toBe("/inicio");
    expect(parentPath("/perfil")).toBe("/inicio");
    expect(parentPath("/coordenacao")).toBe("/inicio");
  });

  it("o contato do perfil volta ao perfil", () => {
    expect(parentPath("/perfil/contato")).toBe("/perfil");
  });

  it("a cadeia da coordenação sobe um nível por vez, sem parar em página que não existe", () => {
    expect(parentPath("/coordenacao/casas/resultados/casa-b")).toBe("/coordenacao/casas/resultados");
    expect(parentPath("/coordenacao/casas/resultados")).toBe("/coordenacao");
    expect(parentPath("/coordenacao/casas/analise/casa-b")).toBe("/coordenacao/casas/analise");
    expect(parentPath("/coordenacao/casas/analise")).toBe("/coordenacao");
    expect(parentPath("/coordenacao/casas/delegacoes")).toBe("/coordenacao");
    expect(parentPath("/coordenacao/autorizados")).toBe("/coordenacao");
    expect(parentPath("/coordenacao/bloqueio")).toBe("/coordenacao");
    expect(parentPath("/coordenacao/espera")).toBe("/coordenacao");
  });

  it("ignora barra final e parâmetros de busca", () => {
    expect(parentPath("/casa/")).toBe("/inicio");
    expect(parentPath("/coordenacao/casas/resultados/casa-b/?aba=1")).toBe("/coordenacao/casas/resultados");
  });

  it("caminho desconhecido dentro de uma seção sobe até a página conhecida mais próxima", () => {
    expect(parentPath("/coordenacao/futura/tela")).toBe("/coordenacao");
  });

  it("caminho fora do app logado volta ao início", () => {
    expect(parentPath("/qualquer-coisa")).toBe("/inicio");
    expect(parentPath("/")).toBe("/inicio");
  });
});
