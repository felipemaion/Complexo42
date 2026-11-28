import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";

// Avisos de TELA da etapa de consentimento do questionário (texto na config, fora do termo da coordenação).
describe("avisos da tela de consentimento", () => {
  const text = instance.houseSelection;

  it("o aviso de que as respostas ficam guardadas cifradas, sem a trava de 4 meses (ADR 0016)", () => {
    expect(JSON.stringify(text)).not.toContain("4 meses");
    expect(text.consentStoredNotice).toBe(
      "Suas respostas ficam guardadas de forma cifrada, só para comparar com as casas se você quiser trocar. Você pode baixá-las ou apagá-las junto com a conta.",
    );
  });
});
