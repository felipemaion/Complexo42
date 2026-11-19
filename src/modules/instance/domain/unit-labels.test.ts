import { describe, expect, it } from "vitest";
import { parseUnitTypeLabels, unitTypeLabel } from "./unit-labels";

const rows = [
  { key: "team", label: "Rótulo da folha", level: 3 },
  { key: "national", label: "Rótulo da raiz", level: 0 },
  { key: "state", label: "Rótulo do meio", level: 1 },
];

describe("parseUnitTypeLabels", () => {
  it("ordena do nível mais alto da árvore para baixo", () => {
    expect(parseUnitTypeLabels(rows)?.map((type) => type.key)).toEqual(["national", "state", "team"]);
  });

  it("aceita lista vazia", () => {
    expect(parseUnitTypeLabels([])).toEqual([]);
  });

  it.each([
    ["não é lista", { key: "team" }],
    ["rótulo vazio", [{ key: "team", label: "", level: 1 }]],
    ["nível negativo", [{ key: "team", label: "X", level: -1 }]],
    ["sem chave", [{ label: "X", level: 1 }]],
    ["nulo", null],
  ])("%s → null", (_name, input) => {
    expect(parseUnitTypeLabels(input)).toBeNull();
  });
});

describe("unitTypeLabel", () => {
  const labels = parseUnitTypeLabels(rows)!;

  it("devolve o rótulo vindo do banco", () => {
    expect(unitTypeLabel(labels, "state")).toBe("Rótulo do meio");
  });

  it("tipo desconhecido → a própria chave, nunca um nome inventado", () => {
    expect(unitTypeLabel(labels, "squad")).toBe("squad");
  });
});
