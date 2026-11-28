import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { HouseWithTotem, TotemMedal } from "./totem-medal";

const houseId = instance.houses[0]!.id;
const house = { houseId, houseName: "Casa Teste" };
const withTotem = (totemCode: string | null, totemName = "Totem Teste", size = 24) => renderToStaticMarkup(createElement(HouseWithTotem, { ...house, totemCode, totemName, size }));

describe("HouseWithTotem (só coordenação)", () => {
  it("escudo da casa e medalha do totem lado a lado, do mesmo tamanho, com alt = nome do totem", () => {
    const out = withTotem("PR");
    const images = [...out.matchAll(/<img[^>]*>/g)].map((match) => match[0]);
    expect(images).toHaveLength(2);
    expect(images[0]).toContain('alt="Casa Teste"');
    expect(images[1]).toContain('alt="Totem Teste"');
    for (const image of images) expect(image).toMatch(/width="24"[^>]*height="24"|height="24"[^>]*width="24"/);
    expect(out).toContain("/totens/pr-128.png");
    expect(out).toContain("/totens/pr-512.webp");
    expect(out.indexOf(`/casas/${houseId}`)).toBeLessThan(out.indexOf("/totens/pr-"));
  });

  it("totem sem medalha (ou sem totem): só o escudo da casa", () => {
    for (const code of [null, "XV", "../PR"]) {
      const out = withTotem(code);
      expect(out).not.toContain("/totens/");
      expect([...out.matchAll(/<img/g)]).toHaveLength(1);
    }
  });
});

describe("TotemMedal", () => {
  it("sem medalha, não renderiza nada", () => {
    expect(renderToStaticMarkup(createElement(TotemMedal, { code: "ZZ", name: "x" }))).toBe("");
  });
});
