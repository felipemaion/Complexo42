import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { CompareHouseGrid } from "./compare-grid";
import { HouseShield } from "./house-shield";

// "Compare as casas" (#272): grade 2x2 de cartões compactos, escudo sem deformar, seleção bem marcada.
const t = instance.houseSelection.compare;
const houses = instance.houses.map((house) => ({ ...house, activities: [], firstSteps: { text: "", videoUrls: [] } }));
const [a, b, c] = houses as [(typeof houses)[number], (typeof houses)[number], (typeof houses)[number]];
const render = (over: { selectedId?: string; currentId?: string; suggestedId?: string } = {}) =>
  renderToStaticMarkup(createElement(CompareHouseGrid, { houses, text: t, disabled: false, onSelect: () => undefined, ...over }));
const card = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-testid="compare-house-${id}"[\\s\\S]*?</button>`))?.[0] ?? "";

describe("CompareHouseGrid", () => {
  it("grade de duas colunas (inclusive no celular), um cartão por casa", () => {
    const html = render();
    expect(html).toMatch(/<ul[^>]*class="[^"]*\bgrid\b[^"]*\bgrid-cols-2\b/);
    expect(html).not.toMatch(/<ul[^>]*sm:grid-cols-1/);
    for (const house of houses) expect(card(html, house.id)).not.toBe("");
  });

  it("cartão compacto: escudo centralizado em cima (72 px no celular, 96 px no desktop), nome em MAIÚSCULAS por CSS e descrição em até 3 linhas", () => {
    const one = card(render(), a.id);
    expect(one).toMatch(/flex-col items-center/);
    expect(one).toContain("size-[72px]");
    expect(one).toContain("sm:size-[96px]");
    expect(one).toMatch(/width="96"[^>]*height="96"|height="96"[^>]*width="96"/);
    expect(one.indexOf("<picture")).toBeLessThan(one.indexOf(`>${a.name}<`));
    expect(one).toMatch(/<span[^>]*class="[^"]*\buppercase\b[^"]*\btracking-wide\b[^"]*"[^>]*>/);
    expect(one).toMatch(/line-clamp-3/);
  });

  it("selecionado: aria-pressed, borda grossa na cor da casa, fundo tingido e marca de seleção; os outros, neutros e sem marca", () => {
    const html = render({ selectedId: b.id });
    const selected = card(html, b.id);
    expect(selected).toContain('aria-pressed="true"');
    expect(selected).toMatch(/border-width:4px/);
    expect(selected).toContain(b.color.light);
    expect(selected).toMatch(/background-color:color-mix\(/);
    expect(selected).toContain('data-testid="compare-check"');
    expect(selected).toContain(t.selectedBadge);
    const other = card(html, a.id);
    expect(other).toContain('aria-pressed="false"');
    expect(other).toMatch(/border-width:2px/);
    expect(other).not.toContain(a.color.light);
    expect(other).not.toContain("background-color");
    expect(other).not.toContain('data-testid="compare-check"');
    expect(html.match(/data-testid="compare-check"/g)).toHaveLength(1);
  });

  it("chips 'atual' e 'sugerida' pequenos, lado a lado na mesma linha; aria-current na casa atual; foco visível", () => {
    const html = render({ currentId: c.id, suggestedId: c.id });
    const both = card(html, c.id);
    expect(both).toMatch(/flex flex-wrap[^>]*>(?=[\s\S]*current-badge)(?=[\s\S]*suggested-badge)/);
    expect(both).toContain('aria-current="true"');
    expect(both).toMatch(/focus-visible:outline/);
    expect(card(html, a.id)).not.toContain("aria-current");
    expect(card(html, a.id)).not.toContain("-badge");
    expect(t.currentBadge.length).toBeLessThan(12);
    expect(t.suggestedBadge.length).toBeLessThan(12);
  });
});

describe("HouseShield", () => {
  it("mantém a proporção: caixa quadrada (largura = altura) e object-contain, sem encolher no flex", () => {
    const html = renderToStaticMarkup(createElement(HouseShield, { houseId: a.id, name: a.name, size: 64 }));
    expect(html).toMatch(/width="64"[^>]*height="64"|height="64"[^>]*width="64"/);
    expect(html).toMatch(/<img[^>]*class="[^"]*\bobject-contain\b/);
    expect(html).toMatch(/<picture[^>]*class="[^"]*\bshrink-0\b/);
  });
});
