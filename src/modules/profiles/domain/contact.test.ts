// Regras puras de "Quem vê meu contato" (#119, ADR 0010).
import { describe, expect, it } from "vitest";
import {
  defaultContactVisibility,
  describeContactView,
  parseContactVisibilityChoice,
  parseContactVisibilityStatus,
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
