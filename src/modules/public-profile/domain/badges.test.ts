import { describe, expect, it } from "vitest";
import { completeBadgePrefs, defaultBadgePrefs, parseBadgeForm } from "./badges";

const form = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });

describe("parseBadgeForm", () => {
  it("ordena pela posição e respeita a caixa mostrar", () => {
    expect(parseBadgeForm(form({ "ordem-house": "2", "ordem-totem": "1", "mostrar-totem": "on" }))).toEqual([
      { kind: "totem", shown: true },
      { kind: "house", shown: false },
    ]);
  });

  it("posição repetida desempata pela ordem padrão", () => {
    expect(parseBadgeForm(form({ "ordem-house": "1", "ordem-totem": "1" }))?.map((p) => p.kind)).toEqual(["house", "totem"]);
  });

  it.each([{}, { "ordem-house": "1" }, { "ordem-house": "0", "ordem-totem": "1" }, { "ordem-house": "x", "ordem-totem": "1" }, { "ordem-house": "100", "ordem-totem": "1" }])(
    "recusa posição ausente ou inválida: %j",
    (entries) => {
      expect(parseBadgeForm(form(entries))).toBeNull();
    },
  );
});

describe("completeBadgePrefs", () => {
  it("sem escolha vira o padrão", () => {
    expect(completeBadgePrefs([])).toEqual(defaultBadgePrefs);
  });

  it("mantém a ordem salva e acrescenta o que falta no fim", () => {
    expect(completeBadgePrefs([{ kind: "totem", shown: false }])).toEqual([
      { kind: "totem", shown: false },
      { kind: "house", shown: true },
    ]);
  });
});
