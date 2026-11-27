import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { chartAxes, chartSpokes, spokePoint } from "./chart";
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
