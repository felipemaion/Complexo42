// Gráfico de aranha com as zonas das casas (#201): zonas, nomes, legenda com a casa da pessoa e
// cores que acompanham o tema (light-dark), na visão da pessoa e na da coordenação.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { crossOrder, type ChartAxis } from "../domain/chart";
import { SpiderChart, type ChartHouses } from "./spider-chart";

const axis = (key: ChartAxis["key"], score: number): ChartAxis => ({ key, label: key, poleA: `${key}-a`, poleB: `${key}-b`, score });
const houseAxes = [axis("house1", -40), axis("house2", 75)];
const allAxes = [...houseAxes, axis("totem1", 10), axis("totem2", -20)];

const houses: ChartHouses = {
  byPoles: { aa: "casa-1", ab: "casa-2", ba: "casa-3", bb: "casa-4" },
  houses: [
    { id: "casa-1", name: "Casa Um", color: { light: "#c0392b", dark: "#f0786b" } },
    { id: "casa-2", name: "Casa Dois", color: { light: "#2563c9", dark: "#7aa8f5" } },
    { id: "casa-3", name: "Casa Três", color: { light: "#1f8a52", dark: "#5ccf8f" } },
    { id: "casa-4", name: "Casa Quatro", color: { light: "#b07d12", dark: "#e6b84a" } },
  ],
  currentHouseId: "casa-2",
  currentLabel: "sua casa",
};
const render = (axes: readonly ChartAxis[], withHouses?: ChartHouses) => renderToStaticMarkup(createElement(SpiderChart, { chart: axes, title: "Perfil", houses: withHouses }));

describe("SpiderChart com as zonas das casas", () => {
  it("desenha uma zona por casa, com o nome dentro, e a legenda das quatro", () => {
    const html = render(houseAxes, houses);
    expect(html.match(/data-testid="house-zone"/g)).toHaveLength(4);
    for (const name of ["Casa Um", "Casa Dois", "Casa Três", "Casa Quatro"]) expect(html).toContain(name);
    expect(html.match(/<li[^>]*class="flex items-center/g)).toHaveLength(4);
  });

  it("destaca só a casa da pessoa na legenda, com o texto da config", () => {
    const html = render(houseAxes, houses);
    expect(html.match(/sua casa/g)).toHaveLength(1);
    expect(html).toMatch(/data-current="true"[^>]*>(<span[^>]*><\/span>)?Casa Dois · sua casa/);
  });

  it("a zona da casa da pessoa é mais forte que as outras", () => {
    const html = render(houseAxes, houses);
    expect(html).toMatch(/data-house="casa-2"><path[^>]*fill-opacity="0.3"/);
    expect(html).toMatch(/data-house="casa-1"><path[^>]*fill-opacity="0.1"/);
  });

  it("os nomes das casas são desenhados por último, por cima de tudo, com fundo opaco e borda na cor da casa", () => {
    const html = render(houseAxes, houses);
    expect(html.indexOf('data-testid="house-zone-label"')).toBeGreaterThan(html.lastIndexOf("<circle"));
    expect(html.match(/data-testid="house-zone-label"><rect[^>]*fill:Canvas;stroke:light-dark\(/g)).toHaveLength(4);
  });

  it("o nome da casa é texto normal do tema (currentColor); a cor da casa fica só na borda e na zona", () => {
    const html = render(houseAxes, houses);
    const labels = html.match(/data-testid="house-zone-label">.*?<\/g>/g) ?? [];
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      expect(label).toMatch(/<text[^>]*fill="currentColor"/);
      expect(label.match(/light-dark\(/g)).toHaveLength(1); // só a borda do retângulo
    }
  });

  it("a cor muda com o tema: light-dark() com a cor clara e a escura da casa", () => {
    expect(render(houseAxes, houses)).toContain("light-dark(#c0392b, #f0786b)");
  });

  it("segue o mapa dos polos: a zona (a,a) é a da casa mapeada em aa", () => {
    const html = render(houseAxes, { ...houses, byPoles: { aa: "casa-4", ab: "casa-3", ba: "casa-2", bb: "casa-1" } });
    expect(html.indexOf('data-house="casa-4"')).toBeLessThan(html.indexOf('data-house="casa-2"'));
  });

  it("sem `houses` o gráfico é o de antes: sem zonas nem legenda", () => {
    const html = render(houseAxes);
    expect(html).not.toContain("house-zone");
    expect(html).not.toContain("house-legend");
  });

  it("sem casa da pessoa (caso em análise), nenhuma é destacada", () => {
    const { currentHouseId: _unused, ...withoutCurrent } = houses;
    void _unused;
    expect(render(houseAxes, withoutCurrent)).not.toContain("sua casa");
  });

  it("na coordenação (8 raios em cruz) as quatro zonas continuam ali, e os raios do totem não as quebram", () => {
    const html = render(crossOrder(allAxes), houses);
    expect(html.match(/data-testid="house-zone"/g)).toHaveLength(4);
    expect(html).toContain("totem1-a");
  });
});
