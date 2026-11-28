import { describe, expect, it } from "vitest";
import { appVersion, evaluateHealth } from "./health";

const version = { tag: "v2026.11.19", commit: "abc1234def56" };

describe("evaluateHealth", () => {
  it("200 com status ok quando banco e esquema respondem", () => {
    expect(evaluateHealth("ok", "ok", "ok", version)).toEqual({
      httpStatus: 200,
      body: { status: "ok", version, db: "ok", schema: "ok", terms: "ok" },
    });
  });

  it.each(["unavailable", "unconfigured"] as const)("503 degradado quando o banco está %s", (db) => {
    expect(evaluateHealth(db, "ok", "ok", version)).toEqual({
      httpStatus: 503,
      body: { status: "degraded", version, db, schema: "ok", terms: "ok" },
    });
  });

  // O caso das 19 horas: banco de pé, API de dados inútil. Antes disto o
  // healthz respondia 200 enquanto toda leitura dava 404.
  it.each(["stale", "unavailable", "unconfigured"] as const)("503 degradado com banco ok e esquema %s", (schema) => {
    expect(evaluateHealth("ok", schema, "ok", version)).toEqual({
      httpStatus: 503,
      body: { status: "degraded", version, db: "ok", schema, terms: "ok" },
    });
  });
});

// #222: versão do termo da config ausente no banco (a tabela vazia do staging): o aceite é recusado em
// silêncio. O corpo diz só "degraded"; o motivo vai ao log.
describe("evaluateHealth: versões do termo", () => {
  it.each(["degraded", "unavailable", "unconfigured"] as const)("503 degradado com o termo %s", (terms) => {
    expect(evaluateHealth("ok", "ok", terms, version)).toEqual({
      httpStatus: 503,
      body: { status: "degraded", version, db: "ok", schema: "ok", terms: "degraded" },
    });
  });
});

describe("appVersion", () => {
  it("usa tag e commit curto da imagem", () => {
    expect(appVersion("v2026.11.19", "abc1234def5678901234")).toEqual({ tag: "v2026.11.19", commit: "abc1234def56" });
  });

  it("fora da imagem, marca dev/unknown", () => {
    expect(appVersion(undefined, undefined)).toEqual({ tag: "dev", commit: "unknown" });
  });
});
