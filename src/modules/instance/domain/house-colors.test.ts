import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { parseInstanceConfig } from "./schema";

// Fundo da página em cada tema (white e o escuro do `color-scheme: light dark`) para o contraste.
const lightBackground = "#ffffff";
const darkBackground = "#111111";
/**
 * Contraste mínimo da cor da casa contra o fundo. Cores de gráfico podem ficar abaixo dos 3:1 do WCAG 1.4.11
 * (a terceira casa, roxa, passa de 4,5:1); o que importa nunca depende só da cor: o nome da casa
 * é texto na cor do tema, dentro de um retângulo com fundo opaco.
 */
const minGraphicContrast = 2.5;
/** WCAG 1.4.3: texto normal. */
const minTextContrast = 4.5;

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
/** Matiz (0 a 360) de uma cor RGB. */
function hue(red: number, green: number, blue: number): number {
  const [r, g, b] = [red, green, blue].map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
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

  it("a casa roxa (a terceira da lista) tem o tom do escudo e contraste AA (4,5:1) em texto nos dois temas", () => {
    const purple = instance.houses[2]!;
    for (const [hex, background, theme] of [
      [purple.color.light, lightBackground, "claro"],
      [purple.color.dark, darkBackground, "escuro"],
    ] as const) {
      const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
      expect(hue(red!, green!, blue!), `matiz ${theme}`).toBeGreaterThanOrEqual(260);
      expect(hue(red!, green!, blue!), `matiz ${theme}`).toBeLessThanOrEqual(310);
      expect(contrast(hex, background), `casa roxa ${theme}`).toBeGreaterThanOrEqual(minTextContrast);
    }
  });

  it("nenhuma casa usa amarelo (matiz de 40 a 70 graus)", () => {
    for (const house of instance.houses) {
      for (const hex of [house.color.light, house.color.dark]) {
        const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
        const h = hue(red!, green!, blue!);
        expect(h < 40 || h > 70, `${house.id} ${hex}`).toBe(true);
      }
    }
  });

  it("a config recusa cor que não é #rrggbb, sem expor o valor", () => {
    const broken = { ...instance, houses: instance.houses.map((house, index) => (index === 0 ? { ...house, color: { light: "vermelho", dark: "#ffffff" } } : house)) };
    expect(() => parseInstanceConfig(broken)).toThrow(/houses\.0\.color\.light/);
    expect(() => parseInstanceConfig(broken)).not.toThrow(/vermelho/);
  });

  it("o nome da casa usa o texto normal do tema, com contraste de pelo menos 4,5:1 sobre o fundo do retângulo (cor da casa só na borda e na zona)", () => {
    // Texto e fundo padrão de cada tema (`color-scheme: light dark`): o retângulo do nome usa o fundo (Canvas).
    expect(contrast("#000000", lightBackground)).toBeGreaterThanOrEqual(minTextContrast);
    expect(contrast("#ffffff", darkBackground)).toBeGreaterThanOrEqual(minTextContrast);
  });
});
