import { describe, expect, it } from "vitest";
import {
  decisionOf,
  fillText,
  isAllowedAllowlistFileName,
  parseAllowlistSource,
  parseConfirmation,
  parseDecisionWord,
  parseWaitlistCursor,
  parseWaitlistDone,
  previewLines,
  waitlistHref,
} from "./coordination";

const ID = "6a1d7c2e-5b4f-4e3a-9c8d-1f2e3a4b5c6d";
const AT = "2026-11-19T12:00:00.123456+00:00";

describe("parâmetros da fila de espera", () => {
  it("cursor válido vai e volta pela URL", () => {
    const href = waitlistHref({ createdAt: AT, profileId: ID });
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseWaitlistCursor(params)).toEqual({ createdAt: AT, profileId: ID });
    expect(waitlistHref()).toBe("/coordenacao/espera");
    expect(waitlistHref(undefined, { feito: "liberado" })).toBe("/coordenacao/espera?feito=liberado");
  });

  it("cursor incompleto ou adulterado volta ao começo", () => {
    expect(parseWaitlistCursor({})).toBeUndefined();
    expect(parseWaitlistCursor({ apos_data: AT })).toBeUndefined();
    expect(parseWaitlistCursor({ apos_data: "ontem", apos_id: ID })).toBeUndefined();
    expect(parseWaitlistCursor({ apos_data: AT, apos_id: "1 or 1=1" })).toBeUndefined();
    expect(parseWaitlistCursor({ apos_data: [AT, AT], apos_id: ID })).toBeUndefined();
  });

  it("data que não existe no calendário volta ao começo (o banco daria 22008)", () => {
    for (const bad of [
      "2026-13-45T12:00:00+00:00",
      "2026-02-30T12:00:00+00:00",
      "2026-02-29T12:00:00+00:00",
      "2026-11-19T24:00:00+00:00",
      "2026-11-19T12:60:00+00:00",
    ]) {
      expect(parseWaitlistCursor({ apos_data: bad, apos_id: ID }), bad).toBeUndefined();
    }
    expect(parseWaitlistCursor({ apos_data: "2028-02-29T23:59:59.999+00:00", apos_id: ID })).toEqual({
      createdAt: "2028-02-29T23:59:59.999+00:00",
      profileId: ID,
    });
  });

  it("confirmação só com uuid e decisão conhecida", () => {
    expect(parseConfirmation({ confirmar: ID, decisao: "liberar" })).toEqual({ profileId: ID, word: "liberar" });
    expect(parseConfirmation({ confirmar: ID, decisao: "bloquear" })).toEqual({ profileId: ID, word: "bloquear" });
    expect(parseConfirmation({ confirmar: ID, decisao: "active" })).toBeNull();
    expect(parseConfirmation({ confirmar: "x", decisao: "liberar" })).toBeNull();
  });

  it("decisão em português vira a do banco", () => {
    expect(parseDecisionWord("liberar")).toBe("liberar");
    expect(parseDecisionWord("blocked")).toBeNull();
    expect(decisionOf("liberar")).toBe("active");
    expect(decisionOf("bloquear")).toBe("blocked");
  });

  it("resultado da decisão: só os conhecidos", () => {
    expect(parseWaitlistDone("liberado")).toBe("liberado");
    expect(parseWaitlistDone("<script>")).toBeNull();
    expect(parseWaitlistDone(["liberado"])).toBeNull();
  });
});

describe("envio da lista", () => {
  it("origem só do enum do banco", () => {
    expect(parseAllowlistSource("academy")).toBe("academy");
    expect(parseAllowlistSource("form")).toBe("form");
    expect(parseAllowlistSource("planilha")).toBeNull();
    expect(parseAllowlistSource(null)).toBeNull();
  });

  it("aceita só .csv e .txt", () => {
    expect(isAllowedAllowlistFileName("Lista Final.CSV")).toBe(true);
    expect(isAllowedAllowlistFileName("emails.txt")).toBe(true);
    expect(isAllowedAllowlistFileName("lista.xlsx")).toBe(false);
    expect(isAllowedAllowlistFileName("lista.csv.exe")).toBe(false);
  });

  it("mostra até 30 linhas ruins e conta o resto, inclusive o que nem veio na lista", () => {
    const lines = Array.from({ length: 35 }, (_, i) => i + 2);
    expect(previewLines(lines, 35)).toEqual({ shown: lines.slice(0, 30), hidden: 5 });
    expect(previewLines(lines, 900)).toEqual({ shown: lines.slice(0, 30), hidden: 870 });
    expect(previewLines([3], 1)).toEqual({ shown: [3], hidden: 0 });
  });

  it("fillText troca todas as chaves", () => {
    expect(fillText("{n} e {n}: {m}", { n: 1, m: "x" })).toBe("1 e 1: x");
  });
});
