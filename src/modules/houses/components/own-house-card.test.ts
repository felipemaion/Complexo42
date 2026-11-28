import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import example from "@config/questionnaire.example.json";
import type { HouseByPoles } from "@/modules/questionnaire";
import { OwnHouse } from "./own-house-card";

// A casa da própria pessoa na página dela (#203) e, desde o #303 (ADR 0014, revisão de 28/11), a medalha do
// totem ao lado do brasão: todo membro vê o totem. Aqui só a apresentação; quem lê e decifra é o servidor.
const house = instance.houses[0]!;
const byPoles = example.houseByPoles as unknown as HouseByPoles;
const card = { kind: "house" as const, houseId: house.id, isAccepted: true, chart: null, byPoles };
const render = (props: { totem?: { code: string; name: string } | null; card?: Parameters<typeof OwnHouse>[0]["card"] }) =>
  renderToStaticMarkup(createElement(OwnHouse, { card: props.card ?? card, houses: instance.houses, text: instance.houseSelection, totem: props.totem }));
const images = (html: string) => [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);

describe("OwnHouse com a medalha do totem (#303)", () => {
  it("com totem: o brasão da casa e a medalha do totem lado a lado, com o nome do totem", () => {
    const out = render({ totem: { code: "PR", name: "Nome do Totem" } });
    expect(images(out)).toHaveLength(2);
    expect(out.indexOf(`/casas/${house.id}`)).toBeLessThan(out.indexOf("/totens/pr-"));
    expect(out).toContain('alt="Nome do Totem"');
    expect(out).toContain('data-testid="result-hero"');
  });

  it("sem totem (ainda pendente, ilegível ou não decifrado): só o brasão da casa, como antes", () => {
    for (const totem of [undefined, null]) {
      const out = render({ totem });
      expect(out).not.toContain("/totens/");
      expect(out).toContain(`/casas/${house.id}`);
    }
  });

  it("código sem medalha na lista de assets: nada de imagem quebrada", () => {
    expect(render({ totem: { code: "ZZ", name: "x" } })).not.toContain("/totens/");
  });

  it("o convite (sem casa nem resultado) não mostra medalha mesmo que chegue um totem", () => {
    const out = render({ card: { kind: "invite" }, totem: { code: "PR", name: "Nome do Totem" } });
    expect(out).not.toContain("/totens/");
    expect(out).toContain('data-testid="own-house-invite"');
  });
});
