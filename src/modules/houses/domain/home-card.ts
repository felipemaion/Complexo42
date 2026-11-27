/*
 * O que a página da própria pessoa mostra da casa (#203). Puro: só a regra. A casa aceita vale mais
 * que a sugerida pelo questionário; o gráfico só existe com as notas do resultado; sem nada, um
 * convite para fazer o questionário. O totem nunca entra aqui (ADR 0014 §2).
 */

export type OwnResult = { houseId: string; hasScores: boolean };

export type HomeCard =
  | { kind: "invite" }
  | { kind: "house"; houseId: string; isAccepted: boolean; showChart: boolean };

export function homeCard(input: { acceptedHouseId: string | null; result: OwnResult | null }): HomeCard {
  const { acceptedHouseId, result } = input;
  const showChart = result?.hasScores ?? false;
  if (acceptedHouseId !== null) return { kind: "house", houseId: acceptedHouseId, isAccepted: true, showChart };
  if (result !== null) return { kind: "house", houseId: result.houseId, isAccepted: false, showChart };
  return { kind: "invite" };
}
