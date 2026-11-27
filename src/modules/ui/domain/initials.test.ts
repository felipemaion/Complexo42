import { describe, expect, it } from "vitest";
import { brandInitials } from "./initials";

describe("brandInitials", () => {
  it("retorna interrogação para entrada vazia ou apenas com espaços", () => {
    // Arrange
    const emptyInput = "   ";

    // Act
    const result = brandInitials(emptyInput);

    // Assert
    expect(result).toBe("?");
  });

  it("extrai a primeira letra de até 3 palavras em caixa alta", () => {
    // Arrange
    const name = "São Paulo Futebol";

    // Act
    const result = brandInitials(name);

    // Assert
    expect(result).toBe("SPF");
  });

  it("limita em 3 caracteres quando houver 4 ou mais palavras", () => {
    // Arrange
    const name = "Vila Nova Cachoeirinha Norte";

    // Act
    const result = brandInitials(name);

    // Assert
    expect(result).toBe("VNC");
  });

  it("preserva inicial e dígitos finais em palavra única com sufixo numérico", () => {
    // Arrange
    const name = "Complexo42";

    // Act
    const result = brandInitials(name);

    // Assert
    expect(result).toBe("C42");
  });

  it("formata as 3 primeiras letras com inicial maiúscula em palavra única sem dígitos", () => {
    // Arrange
    const name = "morumbi";

    // Act
    const result = brandInitials(name);

    // Assert
    expect(result).toBe("Mor");
  });
});
