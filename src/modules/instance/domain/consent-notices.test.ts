import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";

// Avisos de TELA da etapa de consentimento do questionário (texto na config, fora do termo da coordenação).
describe("avisos da tela de consentimento", () => {
  const text = instance.houseSelection;

  it("trava de 4 meses e, depois dela, o aviso de que as respostas ficam guardadas cifradas", () => {
    expect(text.consentLockNotice).toContain("4 meses");
    expect(text.consentStoredNotice).toBe(
      "Suas respostas ficam guardadas de forma cifrada, só para comparar com as casas se você quiser trocar. Você pode baixá-las ou apagá-las junto com a conta.",
    );
  });
});
