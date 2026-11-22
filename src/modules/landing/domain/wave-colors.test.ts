import { describe, expect, it } from "vitest";
import { parseHexColor, rgba, shade } from "./wave-colors";

describe("cores das ondas da entrada", () => {
  it("lê a cor do tema em #rrggbb e em #rgb, com espaços em volta", () => {
    // Arrange / Act / Assert
    expect(parseHexColor(" #d4a537 ")).toEqual([212, 165, 55]);
    expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
  });

  it("cor que não é hexadecimal vira null (o fundo cai na cor padrão, sem quebrar)", () => {
    expect(parseHexColor("")).toBeNull();
    expect(parseHexColor("rgb(1,2,3)")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("#gggggg")).toBeNull();
  });

  it("escurece sem sair de 0 a 255 e sem mudar a cor original", () => {
    // Arrange
    const gold = [212, 165, 55] as const;

    // Act
    const dark = shade(gold, 0.5);

    // Assert
    expect(dark).toEqual([106, 83, 28]);
    expect(shade(gold, 2)).toEqual([255, 255, 110]);
    expect(gold).toEqual([212, 165, 55]);
  });

  it("monta o rgba que o canvas entende", () => {
    expect(rgba([212, 165, 55], 0.5)).toBe("rgba(212,165,55,0.5)");
  });
});
