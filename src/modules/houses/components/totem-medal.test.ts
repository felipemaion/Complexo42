import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { ChosenHouseAndTotem, TotemMedal } from "./totem-medal";

const houseId = instance.houses[0]!.id;
const render = (props: { houseId: string | null; totemCode: string | null }) =>
  renderToStaticMarkup(createElement(ChosenHouseAndTotem, { houseName: "Casa Teste", totemName: "Totem Teste", ...props }));
const images = (html: string) => [...html.matchAll(/<img[^>]*>/g)].map((match) => match[0]);

// Resultado de uma pessoa, na coordenação (só o detalhe, que registra o acesso): brasão da casa ESCOLHIDA e
// medalha do totem em destaque, lado a lado e do mesmo tamanho.
describe("ChosenHouseAndTotem", () => {
  it("brasão da casa escolhida e medalha do totem lado a lado, do mesmo tamanho (grande), alt = nomes", () => {
    const out = render({ houseId, totemCode: "PR" });
    const [shield, medal] = images(out);
    expect(images(out)).toHaveLength(2);
    expect(shield).toContain('alt="Casa Teste"');
    expect(medal).toContain('alt="Totem Teste"');
    for (const image of [shield!, medal!]) expect(image).toMatch(/width="96"[^>]*height="96"|height="96"[^>]*width="96"/);
    expect(out.indexOf(`/casas/${houseId}`)).toBeLessThan(out.indexOf("/totens/pr-"));
    expect(out).toContain("/totens/pr-512.webp");
  });

  it("sem casa escolhida: só a medalha; sem medalha: só o brasão; sem nenhum: nada", () => {
    expect(images(render({ houseId: null, totemCode: "PR" }))).toHaveLength(1);
    expect(render({ houseId: null, totemCode: "PR" })).toContain("/totens/pr-");
    const shieldOnly = render({ houseId, totemCode: "XV" });
    expect(images(shieldOnly)).toHaveLength(1);
    expect(shieldOnly).not.toContain("/totens/");
    expect(render({ houseId: null, totemCode: null })).toBe("");
  });
});

describe("TotemMedal", () => {
  it("sem medalha, não renderiza nada", () => {
    expect(renderToStaticMarkup(createElement(TotemMedal, { code: "ZZ", name: "x" }))).toBe("");
  });
});
