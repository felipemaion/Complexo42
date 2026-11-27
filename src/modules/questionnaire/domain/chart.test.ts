import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { chartAxes, chartSpokes, crossOrder, houseZones, spokePoint } from "./chart";
import { parseQuestionnaire } from "./schema";

const config = parseQuestionnaire(example, instance.houses.map((house) => house.id));
const scores = { house1: -40, house2: 75, totem1: 0, totem2: -100 } as const;

describe("chartAxes", () => {
  it("monta os eixos pedidos com os nomes da config e as notas", () => {
    expect(chartAxes(config, scores, ["house1", "house2"])).toEqual([
      { key: "house1", label: "Dimensão 1", poleA: "Polo 1a", poleB: "Polo 1b", score: -40 },
      { key: "house2", label: "Dimensão 2", poleA: "Polo 2a", poleB: "Polo 2b", score: 75 },
    ]);
  });

  it("a pessoa vê só os eixos da casa: o totem e as notas dele não entram", () => {
    const json = JSON.stringify(chartAxes(config, scores, ["house1", "house2"]));
    expect(json).not.toContain("Dimensão 3");
    expect(json).not.toContain("Dimensão 4");
  });

  it("a coordenação pede os quatro eixos", () => {
    expect(chartAxes(config, scores, ["house1", "house2", "totem1", "totem2"]).map((axis) => axis.key)).toEqual([
      "house1",
      "house2",
      "totem1",
      "totem2",
    ]);
  });
});

describe("chartSpokes", () => {
  const axes = chartAxes(config, scores, ["house1", "house2", "totem1", "totem2"]);

  it("todos os polos a primeiro, depois todos os b, na ordem dos eixos", () => {
    expect(chartSpokes(axes).map((spoke) => `${spoke.side}:${spoke.label}`)).toEqual([
      "a:Polo 1a",
      "a:Polo 2a",
      "a:Polo 3a",
      "a:Polo 4a",
      "b:Polo 1b",
      "b:Polo 2b",
      "b:Polo 3b",
      "b:Polo 4b",
    ]);
  });

  it("a intensidade de cada polo é o que a nota tem dele (negativo = a, positivo = b)", () => {
    expect(chartSpokes(axes).map((spoke) => spoke.intensity)).toEqual([40, 0, 0, 100, 0, 75, 0, 0]);
  });

  it("nota 0: nenhum dos dois polos pesa", () => {
    const spokes = chartSpokes(chartAxes(config, scores, ["totem1"]));
    expect(spokes.map((spoke) => spoke.intensity)).toEqual([0, 0]);
  });

  it("com os eixos da casa são quatro raios (dois polos por eixo)", () => {
    expect(chartSpokes(chartAxes(config, scores, ["house1", "house2"]))).toHaveLength(4);
  });
});

describe("spokePoint", () => {
  const center = { x: 100, y: 100 };

  it("o primeiro raio aponta para cima", () => {
    const point = spokePoint(0, 8, 50, center);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(50);
  });

  it("o polo b de cada eixo fica a meia volta do seu polo a: opostos frente a frente", () => {
    const eixos = 4;
    const count = eixos * 2;
    for (let axis = 0; axis < eixos; axis += 1) {
      const a = spokePoint(axis, count, 50, center);
      const b = spokePoint(axis + eixos, count, 50, center);
      expect(a.x + b.x).toBeCloseTo(2 * center.x);
      expect(a.y + b.y).toBeCloseTo(2 * center.y);
    }
  });

  it("vale também com os dois eixos da casa (4 raios)", () => {
    const a = spokePoint(1, 4, 40, center);
    const b = spokePoint(3, 4, 40, center);
    expect(a.x + b.x).toBeCloseTo(200);
    expect(a.y + b.y).toBeCloseTo(200);
  });

  it("o raio é a distância do centro", () => {
    const point = spokePoint(3, 8, 70, center);
    expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeCloseTo(70);
  });
});

describe("crossOrder (visão da coordenação, #201)", () => {
  const four = chartAxes(config, scores, ["house1", "house2", "totem1", "totem2"]);

  it("põe os eixos da casa em cruz e os do totem nas diagonais: raios a1, a3, a2, a4, b1, b3, b2, b4", () => {
    expect(chartSpokes(crossOrder(four)).map((spoke) => `${spoke.side}:${spoke.axis}`)).toEqual([
      "a:house1", "a:totem1", "a:house2", "a:totem2", "b:house1", "b:totem1", "b:house2", "b:totem2",
    ]);
  });

  it("os eixos da casa ficam a 90° entre si (raios 0, 2, 4 e 6 de 8)", () => {
    const spokes = chartSpokes(crossOrder(four));
    const houseIndexes = spokes.flatMap((spoke, index) => (spoke.axis.startsWith("house") ? [index] : []));
    expect(houseIndexes).toEqual([0, 2, 4, 6]);
  });

  it("só com os dois eixos da casa, a ordem não muda; não altera o que recebeu", () => {
    const two = chartAxes(config, scores, ["house1", "house2"]);
    expect(crossOrder(two)).toEqual(two);
    const before = [...four];
    crossOrder(four);
    expect(four).toEqual(before);
  });
});

describe("houseZones (zonas coloridas das casas, #201)", () => {
  const byPoles = { aa: "casa-aa", ab: "casa-ab", ba: "casa-ba", bb: "casa-bb" };
  const geometry = { center: { x: 180, y: 180 }, radius: 100, labelRadius: 70 };
  const zonesOf = (keys: readonly ("house1" | "house2" | "totem1" | "totem2")[]) => {
    const axes = chartAxes(config, scores, keys);
    return houseZones(chartSpokes(keys.length === 4 ? crossOrder(axes) : axes), byPoles, geometry);
  };

  it("são quatro, uma por casa do mapa, seguindo os polos: (a,a), (b,a), (b,b), (a,b) em volta do gráfico", () => {
    expect(zonesOf(["house1", "house2"]).map((zone) => [zone.polesKey, zone.houseId])).toEqual([
      ["aa", "casa-aa"],
      ["ba", "casa-ba"],
      ["bb", "casa-bb"],
      ["ab", "casa-ab"],
    ]);
  });

  it("a casa de cada zona vem do mapa da config, não do código", () => {
    const swapped = { aa: "x", ab: "y", ba: "z", bb: "w" };
    const axes = chartAxes(config, scores, ["house1", "house2"]);
    expect(houseZones(chartSpokes(axes), swapped, geometry).map((zone) => zone.houseId)).toEqual(["x", "z", "w", "y"]);
  });

  it("o quadrante (a,a) vai do raio a1 (cima) ao raio a2 (direita): rótulo no canto de cima à direita", () => {
    const [aa] = zonesOf(["house1", "house2"]);
    expect(aa!.path).toBe("M180,180 L180,80 A100,100 0 0 1 280,180 Z");
    expect(aa!.label.x).toBeGreaterThan(180);
    expect(aa!.label.y).toBeLessThan(180);
  });

  it("com os 8 raios da coordenação os quadrantes são os mesmos (raios 0, 2, 4 e 6)", () => {
    expect(zonesOf(["house1", "house2", "totem1", "totem2"]).map((zone) => zone.path)).toEqual(
      zonesOf(["house1", "house2"]).map((zone) => zone.path),
    );
  });

  it("os rótulos ficam cada um no seu quadrante, a 70% do raio das pontas", () => {
    const labels = zonesOf(["house1", "house2"]).map((zone) => [Math.sign(zone.label.x - 180), Math.sign(zone.label.y - 180)]);
    expect(labels).toEqual([[1, -1], [1, 1], [-1, 1], [-1, -1]]);
  });

  it("sem os dois eixos da casa não há zonas", () => {
    expect(zonesOf(["totem1", "totem2"])).toEqual([]);
    expect(zonesOf(["house1"])).toEqual([]);
  });
});
