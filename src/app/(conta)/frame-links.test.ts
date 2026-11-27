// Moldura das páginas logadas (menu e rodapé): sem prefetch (27/11). Com prefetch, abrir qualquer
// página fazia o navegador buscar Missões, Equipe, Placar e as páginas do rodapé em segundo plano; no
// questionário da casa isso aparecia como requisição no meio das respostas (e2e/house-live.spec.ts:
// "enquanto a pessoa responde, o navegador não faz requisição nenhuma"), e no celular gasta dados à toa.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "src", "app", "(conta)");

describe("moldura das páginas logadas", () => {
  it.each(["nav-links.tsx", "layout.tsx"])("%s: todo link sem prefetch", (file) => {
    // Arrange
    const source = readFileSync(join(dir, file), "utf8");

    // Act
    const links = source.match(/<Link\b[^>]*>/gs) ?? [];

    // Assert
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain("prefetch={false}");
  });

  it("só a troca de tela anima: resposta de formulário na mesma tela não (update=\"none\")", () => {
    // Arrange: animando a resposta de um formulário, o que se digitava durante a animação ia para a
    // tela velha e se perdia (e2e/profile.spec.ts, bairro corrigido voltava ao valor errado; 27/11).
    const source = readFileSync(join(dir, "template.tsx"), "utf8");

    // Act
    const transition = source.match(/<ViewTransition\b[^>]*>/s)?.[0] ?? "";

    // Assert
    expect(transition).toContain('update="none"');
  });
});
