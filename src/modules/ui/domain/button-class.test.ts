import { describe, expect, it } from "vitest";
import type { ButtonVariant } from "../types";
import { buttonClass } from "./button-class";

describe("buttonClass", () => {
  it("variante primary aplica preenchimento principal e texto de contraste", () => {
    // Arrange
    const variant: ButtonVariant = "primary";

    // Act
    const result = buttonClass(variant);

    // Assert
    expect(result).toContain("bg-primary");
    expect(result).toContain("text-on-primary");
    expect(result).toContain("border-primary");
  });

  it("variante secondary aplica fundo de superfície e borda na cor primária", () => {
    // Arrange
    const variant: ButtonVariant = "secondary";

    // Act
    const result = buttonClass(variant);

    // Assert
    expect(result).toContain("bg-surface");
    expect(result).toContain("text-primary");
    expect(result).toContain("border-primary");
  });

  it("variante quiet aplica fundo transparente e borda neutra de linha", () => {
    // Arrange
    const variant: ButtonVariant = "quiet";

    // Act
    const result = buttonClass(variant);

    // Assert
    expect(result).toContain("bg-transparent");
    expect(result).toContain("text-primary");
    expect(result).toContain("border-line");
  });

  it("variante danger aplica contraste de alerta e borda de perigo", () => {
    // Arrange
    const variant: ButtonVariant = "danger";

    // Act
    const result = buttonClass(variant);

    // Assert
    expect(result).toContain("bg-surface");
    expect(result).toContain("text-danger");
    expect(result).toContain("border-danger");
  });

  it("todas as variantes possuem altura mínima min-h-14 e anel de foco configurado", () => {
    // Arrange
    const variants: readonly ButtonVariant[] = ["primary", "secondary", "quiet", "danger"];

    // Act & Assert
    for (const variant of variants) {
      const result = buttonClass(variant);
      expect(result).toContain("min-h-14");
      expect(result).toContain("focus-visible:ring-focus");
    }
  });

  it("isFullWidth false troca largura de w-full para w-auto", () => {
    // Arrange
    const variant: ButtonVariant = "primary";

    // Act
    const full = buttonClass(variant, { isFullWidth: true });
    const auto = buttonClass(variant, { isFullWidth: false });

    // Assert
    expect(full).toContain("w-full");
    expect(full).not.toContain("w-auto");
    expect(auto).toContain("w-auto");
    expect(auto).not.toContain("w-full");
  });

  it("nenhuma variante gera classes CSS duplicadas", () => {
    // Arrange
    const variants: readonly ButtonVariant[] = ["primary", "secondary", "quiet", "danger"];

    // Act & Assert
    for (const variant of variants) {
      const classes = buttonClass(variant).split(/\s+/).filter(Boolean);
      const uniqueClasses = new Set(classes);
      expect(classes.length).toBe(uniqueClasses.size);
    }
  });
});
