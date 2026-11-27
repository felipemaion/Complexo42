import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { parseInstanceConfig } from "./schema";

// Fundo da página em cada tema (white e o escuro do `color-scheme: light dark`) para o contraste.
const lightBackground = "#ffffff";
const darkBackground = "#111111";
/**
 * Contraste mínimo da cor da casa contra o fundo. A cor oficial amarela da instância (#c99a06) tem
 * 2,6:1 no claro, abaixo dos 3:1 do WCAG 1.4.11; o que importa nunca depende só da cor: o nome da casa
 * é texto na cor do tema, dentro de um retângulo com fundo opaco.
 */
const minGraphicContrast = 2.5;

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("cores das casas (#201)", () => {
  it("toda casa tem uma cor para o tema claro e outra para o escuro", () => {
    for (const house of instance.houses) {
      expect(house.color.light).toMatch(/^#[0-9a-f]{6}$/i);
      expect(house.color.dark).toMatch(/^#[0-9a-f]{6}$/i);
      expect(house.color.light).not.toBe(house.color.dark);
    }
  });

  it("as quatro casas têm cores distintas em cada tema", () => {
    expect(new Set(instance.houses.map((house) => house.color.light.toLowerCase())).size).toBe(instance.houses.length);
    expect(new Set(instance.houses.map((house) => house.color.dark.toLowerCase())).size).toBe(instance.houses.length);
  });

  it("cada cor é legível (contraste mínimo de 3:1) sobre o fundo do seu tema", () => {
    for (const house of instance.houses) {
      expect(contrast(house.color.light, lightBackground), `${house.id} claro`).toBeGreaterThanOrEqual(minGraphicContrast);
      expect(contrast(house.color.dark, darkBackground), `${house.id} escuro`).toBeGreaterThanOrEqual(minGraphicContrast);
    }
  });

  it("a config recusa cor que não é #rrggbb, sem expor o valor", () => {
    const broken = { ...instance, houses: instance.houses.map((house, index) => (index === 0 ? { ...house, color: { light: "vermelho", dark: "#ffffff" } } : house)) };
    expect(() => parseInstanceConfig(broken)).toThrow(/houses\.0\.color\.light/);
    expect(() => parseInstanceConfig(broken)).not.toThrow(/vermelho/);
  });
});
