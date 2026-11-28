import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
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

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (x: string, y: string) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((m, n) => n - m) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** Os elementos `<button>` da árvore devolvida pelo componente (sem renderizar): para clicar sem navegador. */
function buttons(node: ReactNode, out: ReactElement<{ onClick?: () => void; disabled?: boolean; "data-testid"?: string }>[] = []) {
  if (Array.isArray(node)) node.forEach((child) => buttons(child, out));
  else if (isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean; "data-testid"?: string }>(node)) {
    if (node.type === "button") out.push(node);
    buttons(node.props.children, out);
  }
  return out;
}

describe("CompareHouseGrid: casa atual, nome, chips e clique (follow-up do #273)", () => {
  it("com outra casa selecionada, a atual leva borda leve na cor da casa (2 px, mais fina que a da seleção); os outros seguem neutros", () => {
    const html = render({ currentId: a.id, selectedId: b.id });
    const current = card(html, a.id);
    expect(current).toMatch(/border-width:2px/);
    expect(current).toMatch(/border-color:color-mix\([^)]*light-dark\(/);
    expect(current).toContain(a.color.light);
    expect(current).not.toContain("background-color");
    expect(card(html, b.id)).toMatch(/border-width:4px/);
    expect(card(html, c.id)).not.toContain(c.color.light);
    expect(card(html, c.id)).not.toContain("color-mix");
  });

  it("quando a própria atual está selecionada, vale a borda de seleção normal (4 px, cor cheia)", () => {
    const current = card(render({ currentId: a.id, selectedId: a.id }), a.id);
    expect(current).toMatch(/border-width:4px/);
    expect(current).not.toMatch(/border-color:color-mix/);
    expect(current).toContain('data-testid="compare-check"');
    expect(current).toContain('aria-current="true"');
  });

  it("o nome quebra sem estourar a coluna (320 px): break-words e hifenização", () => {
    const name = card(render(), a.id).match(/<span[^>]*uppercase[^>]*>/)?.[0] ?? "";
    expect(name).toMatch(/\bbreak-words\b/);
    expect(name).toMatch(/\bhyphens-auto\b/);
    expect(name).toMatch(/\bmax-w-full\b/);
  });

  it("chips com texto completo para leitor de tela (sr-only) e a versão curta escondida dele", () => {
    const both = card(render({ currentId: c.id, suggestedId: c.id }), c.id);
    expect(t.currentLabel).toBe("Sua casa atual");
    expect(t.suggestedLabel).toBe("Sua casa sugerida");
    expect(both).toContain(`<span class="sr-only">${t.currentLabel}</span>`);
    expect(both).toContain(`<span class="sr-only">${t.suggestedLabel}</span>`);
    expect(both).toContain(`<span aria-hidden="true">${t.currentBadge}</span>`);
    expect(both).toContain(`<span aria-hidden="true">${t.suggestedBadge}</span>`);
  });

  it("clicar no cartão chama onSelect com a casa; desligado, o botão fica desabilitado", () => {
    const picked: string[] = [];
    const tree = CompareHouseGrid({ houses, text: t, disabled: false, onSelect: (id) => picked.push(id) });
    const all = buttons(tree);
    expect(all).toHaveLength(houses.length);
    for (const button of all) button.props.onClick?.();
    expect(picked).toEqual(houses.map((house) => house.id));
    const off = buttons(CompareHouseGrid({ houses, text: t, disabled: true, onSelect: () => undefined }));
    expect(off.every((button) => button.props.disabled === true)).toBe(true);
  });

  it("a marca ✓ tem contraste de pelo menos 3:1 (elemento gráfico) sobre a cor de cada casa, nos dois temas", () => {
    for (const house of houses) {
      expect(contrast("#ffffff", house.color.light), `${house.id} claro`).toBeGreaterThanOrEqual(3);
      expect(contrast("#000000", house.color.dark), `${house.id} escuro`).toBeGreaterThanOrEqual(3);
    }
  });
});
