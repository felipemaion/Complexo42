import { describe, expect, it } from "vitest";
import { parseNewsForm } from "./news-form";

const UNIT = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-28T12:00:00Z");
const base = { unidade: UNIT, titulo: "Encontro", texto: "Sábado, 10h.", link: "", validade: "" };

describe("parseNewsForm (#307)", () => {
  it("aceita o mínimo e apara os espaços", () => {
    expect(parseNewsForm({ ...base, titulo: "  Encontro  " }, NOW)).toEqual({
      ok: true,
      value: { unitId: UNIT, title: "Encontro", body: "Sábado, 10h.", link: null, expiresAt: null },
    });
  });

  it("aceita link https e validade futura (fim do dia, horário de Brasília)", () => {
    const parsed = parseNewsForm({ ...base, link: "https://exemplo.org/encontro", validade: "2026-12-05" }, NOW);
    expect(parsed).toEqual({
      ok: true,
      value: { unitId: UNIT, title: "Encontro", body: "Sábado, 10h.", link: "https://exemplo.org/encontro", expiresAt: "2026-12-05T23:59:59-03:00" },
    });
  });

  it.each([
    ["unidade que não é id", { unidade: "x" }],
    ["unidade ausente", { unidade: undefined }],
    ["título vazio", { titulo: "   " }],
    ["título com mais de 80", { titulo: "x".repeat(81) }],
    ["texto vazio", { texto: "" }],
    ["texto com mais de 280", { texto: "x".repeat(281) }],
    ["HTML no título", { titulo: "<b>oi</b>" }],
    ["HTML no texto", { texto: "a > b" }],
    ["link http", { link: "http://exemplo.org" }],
    ["link javascript:", { link: "javascript:alert(1)" }],
    ["link data:", { link: "data:text/html,oi" }],
    ["link sem domínio", { link: "https://localhost/x" }],
    ["validade em formato errado", { validade: "05/12/2026" }],
    ["validade que não existe", { validade: "2026-02-31" }],
    ["validade no passado", { validade: "2026-11-27" }],
  ])("recusa %s", (_name, patch) => {
    expect(parseNewsForm({ ...base, ...patch }, NOW)).toEqual({ ok: false, error: "invalid" });
  });

  it("ignora campos desconhecidos e valores que não são texto", () => {
    expect(parseNewsForm({ ...base, titulo: 7 as unknown as string, extra: "x" }, NOW)).toEqual({ ok: false, error: "invalid" });
  });
});
