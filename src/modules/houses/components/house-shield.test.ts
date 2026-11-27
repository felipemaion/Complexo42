import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HouseWithShield } from "./house-shield";

// A casa com o escudo ao lado do nome (resultado da coordenação: casa sugerida E casa escolhida).
describe("HouseWithShield", () => {
  it("mostra o escudo da casa (alt = nome) ao lado do nome, com tamanho fixo", () => {
    const html = renderToStaticMarkup(createElement(HouseWithShield, { houseId: "casa-a", name: "Casa A", size: 24 }));
    expect(html).toContain('alt="Casa A"');
    expect(html).toContain('data-testid="house-shield"');
    expect(html).toContain("/casas/casa-a-128.webp");
    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
    expect(html).toMatch(/<\/picture>\s*Casa A/);
  });

  it("não aceita id de casa que vira caminho fora de /casas", () => {
    expect(() => renderToStaticMarkup(createElement(HouseWithShield, { houseId: "../x", name: "X" }))).toThrow();
  });
});
