import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { totemMedalAssets, totemMedalCodes } from "./totem-medal";

// Medalhas dos totens (public/totens): só as telas da coordenação as usam. O caminho vem do código do totem
// (conjunto fechado), nunca de texto livre.
describe("totemMedalAssets", () => {
  it.each(["PR", "PA", "AR", "AA"])("o totem %s tem WebP e PNG em 512 e 128, e os arquivos existem", (code) => {
    const assets = totemMedalAssets(code);
    expect(assets).not.toBeNull();
    const id = code.toLowerCase();
    expect(assets).toEqual({
      webp512: `/totens/${id}-512.webp`,
      png512: `/totens/${id}-512.png`,
      webp128: `/totens/${id}-128.webp`,
      png128: `/totens/${id}-128.png`,
    });
    for (const path of Object.values(assets!)) expect(existsSync(`public${path}`), path).toBe(true);
  });

  it("os quatro códigos são exatamente os das medalhas", () => {
    expect([...totemMedalCodes].sort()).toEqual(["AA", "AR", "PA", "PR"]);
  });

  it.each([null, "", "XV", "pr", "../PR", "PR/../x", "PRX", "p r"])("código fora do conjunto (%j) não tem medalha", (code) => {
    expect(totemMedalAssets(code)).toBeNull();
  });
});
