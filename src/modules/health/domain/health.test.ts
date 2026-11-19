import { describe, expect, it } from "vitest";
import { appVersion, evaluateHealth } from "./health";

const version = { tag: "v2026.11.19", commit: "abc1234def56" };

describe("evaluateHealth", () => {
  it("200 com status ok quando o banco responde", () => {
    expect(evaluateHealth("ok", version)).toEqual({ httpStatus: 200, body: { status: "ok", version, db: "ok" } });
  });

  it.each(["unavailable", "unconfigured"] as const)("503 degradado quando o banco está %s", (db) => {
    expect(evaluateHealth(db, version)).toEqual({ httpStatus: 503, body: { status: "degraded", version, db } });
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
