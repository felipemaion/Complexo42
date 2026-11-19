// Fila de espera (#26): a linha com nome ilegível não deixa liberar (nem por um pedido de
// confirmação vindo da URL), mostra o aviso e ainda permite bloquear.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { instance } from "@config/instance";
import { WaitlistQueue, type WaitlistQueueEntry } from "./waitlist-queue";

const known: WaitlistQueueEntry = {
  profileId: "6a1d7c2e-5b4f-4e3a-9c8d-1f2e3a4b5c6d",
  displayName: "Pessoa Conhecida",
  isIdentified: true,
  place: "São Paulo (SP)",
  since: "19 de novembro de 2026",
};
const unknown: WaitlistQueueEntry = {
  profileId: "7b2e8d3f-6c5a-4f4b-8d9e-2a3b4c5d6e7f",
  displayName: instance.coordination.waitlist.unknownName,
  isIdentified: false,
  place: "SP",
  since: "19 de novembro de 2026",
};

const render = (confirmation: { profileId: string; word: "liberar" | "bloquear" } | null) =>
  renderToStaticMarkup(
    createElement(WaitlistQueue, {
      entries: [known, unknown],
      nextCursor: null,
      confirmation,
      action: async () => {},
      text: instance.coordination.waitlist,
    }),
  );

const confirmLink = (id: string, word: string) => `confirmar=${id}&amp;decisao=${word}`;

describe("WaitlistQueue com nome ilegível", () => {
  it("sem link de liberar, com aviso; bloquear continua", () => {
    const html = render(null);
    expect(html).toContain(confirmLink(known.profileId, "liberar"));
    expect(html).not.toContain(confirmLink(unknown.profileId, "liberar"));
    expect(html).toContain(confirmLink(unknown.profileId, "bloquear"));
    expect(html).toContain(instance.coordination.waitlist.unknownNameNote);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it("um pedido de liberar pela URL não abre a confirmação; o de bloquear abre", () => {
    expect(render({ profileId: unknown.profileId, word: "liberar" })).not.toContain(
      instance.coordination.waitlist.confirmApproveButton,
    );
    expect(render({ profileId: unknown.profileId, word: "bloquear" })).toContain(
      instance.coordination.waitlist.confirmBlockButton,
    );
    expect(render({ profileId: known.profileId, word: "liberar" })).toContain(
      instance.coordination.waitlist.confirmApproveButton,
    );
  });
});
