import { describe, expect, it } from "vitest";
import { homeCard } from "./home-card";

describe("homeCard (o que a página da pessoa mostra da casa, #203)", () => {
  it("sem casa aceita e sem resultado: convite para fazer o questionário", () => {
    expect(homeCard({ acceptedHouseId: null, result: null })).toEqual({ kind: "invite" });
  });

  it("só com resultado: mostra a casa sugerida (ainda não aceita) e o gráfico", () => {
    expect(homeCard({ acceptedHouseId: null, result: { houseId: "casa-a", hasScores: true } })).toEqual({
      kind: "house",
      houseId: "casa-a",
      isAccepted: false,
      showChart: true,
    });
  });

  it("com casa aceita: mostra a aceita, mesmo que o resultado sugira outra", () => {
    expect(homeCard({ acceptedHouseId: "casa-b", result: { houseId: "casa-a", hasScores: true } })).toMatchObject({
      houseId: "casa-b",
      isAccepted: true,
      showChart: true,
    });
  });

  it("casa aceita sem questionário (escolheu direto): mostra a casa, sem gráfico", () => {
    expect(homeCard({ acceptedHouseId: "casa-b", result: null })).toEqual({ kind: "house", houseId: "casa-b", isAccepted: true, showChart: false });
  });

  it("resultado antigo, sem notas: mostra a casa, sem gráfico", () => {
    expect(homeCard({ acceptedHouseId: null, result: { houseId: "casa-a", hasScores: false } })).toMatchObject({ showChart: false });
  });
});
