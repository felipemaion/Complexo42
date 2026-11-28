// Regras puras de "Quem vê meu contato" (#119, ADR 0010).
import { describe, expect, it } from "vitest";
import {
  defaultContactVisibility,
  describeContactView,
  parseContactVisibilityChoice,
  parseContactVisibilityStatus,
  viewStateFromContact,
  visibilityFromRows,
} from "./contact";

describe("parseContactVisibilityChoice", () => {
  it("aceita cada contato com cada escolha", () => {
    expect(parseContactVisibilityChoice({ kind: "whatsapp", scope: "team" })).toEqual({ kind: "whatsapp", scope: "team" });
    expect(parseContactVisibilityChoice({ kind: "email", scope: "team_house" })).toEqual({ kind: "email", scope: "team_house" });
    expect(parseContactVisibilityChoice({ kind: "social", scope: "none" })).toEqual({ kind: "social", scope: "none" });
  });

  it("recusa tipo ou escolha fora da lista, e o que não é texto", () => {
    expect(parseContactVisibilityChoice({ kind: "telefone", scope: "team" })).toBeNull();
    expect(parseContactVisibilityChoice({ kind: "whatsapp", scope: "todos" })).toBeNull();
    expect(parseContactVisibilityChoice({ kind: null, scope: "team" })).toBeNull();
    expect(parseContactVisibilityChoice(undefined)).toBeNull();
  });
});

describe("visibilityFromRows", () => {
  it("sem linha, ninguém além da coordenação vê (none)", () => {
    expect(visibilityFromRows([])).toEqual(defaultContactVisibility);
    expect(defaultContactVisibility).toEqual({ whatsapp: "none", social: "none", email: "none" });
  });

  it("completa com none o que a pessoa não escolheu", () => {
    expect(visibilityFromRows([{ kind: "email", scope: "team" }])).toEqual({ whatsapp: "none", social: "none", email: "team" });
  });

  it("recusa linha em formato inesperado", () => {
    expect(() => visibilityFromRows([{ kind: "email", scope: "todos" }])).toThrow();
  });
});

describe("parseContactVisibilityStatus", () => {
  it("só os valores conhecidos", () => {
    expect(parseContactVisibilityStatus("salva")).toBe("salva");
    expect(parseContactVisibilityStatus("erro")).toBe("erro");
    expect(parseContactVisibilityStatus("<script>")).toBeNull();
    expect(parseContactVisibilityStatus(["salva"])).toBeNull();
  });
});

describe("describeContactView", () => {
  const text = {
    viewsLine: "{name} viu {kind} em {date}",
    viewsKinds: { whatsapp: "seu WhatsApp", social: "suas redes", email: "seu e-mail" },
    viewsUnknownPerson: "Alguém que saiu",
  };

  it("nome, contato e data de Brasília", () => {
    expect(describeContactView({ viewerName: "Joana", kind: "whatsapp", viewedAt: "2026-11-20T01:30:00Z" }, text)).toBe(
      "Joana viu seu WhatsApp em 19/11/2026, 22:30",
    );
  });

  it("conta excluída aparece com o texto genérico", () => {
    expect(describeContactView({ viewerName: null, kind: "email", viewedAt: "2026-11-19T15:00:00Z" }, text)).toBe(
      "Alguém que saiu viu seu e-mail em 19/11/2026, 12:00",
    );
  });
});

describe("viewStateFromContact", () => {
  it("WhatsApp: número formatado e link wa.me só com dígitos", () => {
    expect(viewStateFromContact("whatsapp", { whatsapp: "+5511912345678" })).toEqual({
      status: "ok",
      kind: "whatsapp",
      empty: false,
      whatsapp: { display: "(11) 91234-5678", href: "https://wa.me/5511912345678" },
    });
  });

  it("WhatsApp fora do padrão aparece como texto, sem link", () => {
    const state = viewStateFromContact("whatsapp", { whatsapp: "javascript:alert(1)" });
    expect(state.status === "ok" && state.whatsapp?.href).toBeNull();
  });

  it("e-mail com forma válida ganha mailto; o estranho vira texto", () => {
    expect(viewStateFromContact("email", { email: "joana@exemplo.org" })).toMatchObject({ email: { href: "mailto:joana@exemplo.org" } });
    expect(viewStateFromContact("email", { email: 'x"><script>@a.org' })).toMatchObject({ email: { href: null } });
  });

  it("redes e valores ausentes", () => {
    expect(viewStateFromContact("social", { social: ["https://exemplo.org/a"] })).toMatchObject({ empty: false, social: ["https://exemplo.org/a"] });
    expect(viewStateFromContact("social", { social: [] })).toEqual({ status: "ok", kind: "social", empty: true });
    expect(viewStateFromContact("whatsapp", { whatsapp: null })).toEqual({ status: "ok", kind: "whatsapp", empty: true });
    expect(viewStateFromContact("email", {})).toEqual({ status: "ok", kind: "email", empty: true });
  });
});
