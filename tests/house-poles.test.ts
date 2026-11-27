// As casas reais e o mapa das casas pelos polos dos eixos 1 e 2 (resposta do stakeholder de 26/11,
// ADR 0011 e ADR 0014): eixo 1 polo a = Esparta/Atenas e polo b = Alexandria/Siracusa; eixo 2
// polo a = Esparta/Alexandria e polo b = Atenas/Siracusa. Fica em tests/ (e não em src/) porque
// os nomes das casas são da instância (R17).
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import { parseQuestionnaire, scoreQuestionnaire } from "@/modules/questionnaire";

const houseIds = instance.houses.map((house) => house.id);
const config = parseQuestionnaire(example, houseIds);

/** Respostas em que todos os itens de cada eixo recebem a intensidade pedida (negativo = polo a). */
function answers(house1: -3 | 3, house2: -3 | 3) {
  const byAxis = { house1, house2, totem1: -3, totem2: -3 } as const;
  const out: Record<string, -3 | 3> = {};
  for (const [axis, value] of Object.entries(byAxis)) for (const id of config.axes[axis as keyof typeof byAxis].itemIds) out[id] = value;
  return out;
}

describe("casas reais (config/instance.ts)", () => {
  it("os ids e os nomes são os das quatro casas", () => {
    expect(instance.houses.map((house) => [house.id, house.name])).toEqual([
      ["esparta", "Esparta"],
      ["atenas", "Atenas"],
      ["alexandria", "Alexandria"],
      ["siracusa", "Siracusa"],
    ]);
  });
});

describe("casa pelos polos dos eixos 1 e 2", () => {
  it.each([
    ["a", "a", -3, -3, "esparta"],
    ["a", "b", -3, 3, "atenas"],
    ["b", "a", 3, -3, "alexandria"],
    ["b", "b", 3, 3, "siracusa"],
  ] as const)("eixo 1 polo %s e eixo 2 polo %s levam a %s", (_p1, _p2, house1, house2, expected) => {
    expect(scoreQuestionnaire(config, answers(house1, house2))).toMatchObject({ status: "ok", houseId: expected });
  });

  it("o mapa do exemplo público usa os ids reais (aa, ab, ba, bb)", () => {
    expect(config.houseByPoles).toEqual({ aa: "esparta", ab: "atenas", ba: "alexandria", bb: "siracusa" });
  });
});
