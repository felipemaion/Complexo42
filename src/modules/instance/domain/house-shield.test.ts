import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { appLogo, shieldAssets } from "./house-shield";

describe("escudos das casas (public/casas)", () => {
  it("cada casa da config tem as quatro imagens (WebP e PNG, 512 e 128), leves", () => {
    for (const house of instance.houses) {
      const assets = shieldAssets(house.id);
      for (const path of [assets.webp512, assets.png512, assets.webp128, assets.png128]) {
        expect(path.startsWith("/casas/"), path).toBe(true);
        expect(existsSync(`public${path}`), `${house.id}: falta public${path}`).toBe(true);
      }
      // Os originais tinham mais de 500 KB; o WebP de 512 fica bem abaixo e o de 128 é minúsculo.
      expect(statSync(`public${assets.webp512}`).size).toBeLessThan(120_000);
      expect(statSync(`public${assets.webp128}`).size).toBeLessThan(20_000);
    }
  });

  it("o logo do app existe e não é uma casa da config", () => {
    const icon = appLogo();
    expect(existsSync(`public${icon.webp128}`)).toBe(true);
    expect(existsSync(`public${icon.png512}`)).toBe(true);
    expect(instance.houses.map((house) => house.id)).not.toContain("app-logo");
  });

  it("recusa id que não é de casa (nada de caminho montado a partir de texto livre)", () => {
    expect(() => shieldAssets("../segredo")).toThrow();
    expect(() => shieldAssets("Casa X")).toThrow();
    expect(() => shieldAssets("")).toThrow();
  });
});
