import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HouseHero } from "./house-shield";

// Bloco da casa: escudo grande e centralizado, nome abaixo, sem o quadradinho de cor.
describe("HouseHero", () => {
  const html = renderToStaticMarkup(createElement(HouseHero, { houseId: "casa-a", name: "Casa A", headingId: "nome" }));

  it("escudo grande (140 px no celular, 180 px a partir de sm), com largura/altura no HTML e alt = nome", () => {
    expect(html).toContain('alt="Casa A"');
    expect(html).toContain('width="180"');
    expect(html).toContain('height="180"');
    expect(html).toContain("size-[140px]");
    expect(html).toContain("sm:size-[180px]");
  });

  it("centralizado, com o nome abaixo do escudo e sem quadradinho de cor", () => {
    expect(html).toMatch(/flex-col items-center/);
    expect(html).toMatch(/text-center/);
    expect(html.indexOf("<picture")).toBeLessThan(html.indexOf("Casa A</"));
    expect(html).toContain('id="nome"');
    expect(html).not.toContain("rounded-sm");
  });

  it("nome em MAIÚSCULAS só por CSS (o texto continua como na config), com espaçamento leve entre letras", () => {
    expect(html).toMatch(/<h2[^>]*class="[^"]*\buppercase\b[^"]*"/);
    expect(html).toMatch(/<h2[^>]*class="[^"]*\btracking-wide\b/);
    expect(html).toContain(">Casa A</h2>");
  });
});
