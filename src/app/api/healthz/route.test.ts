import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup(fetchImpl: () => Promise<Response>) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DB_HEALTH_URL", "http://rest:3001/ready");
  vi.stubEnv("GIT_SHA", "abc1234def5678");
  vi.stubEnv("APP_VERSION", "v2026.11.19");
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
}

describe("GET /api/healthz", () => {
  it("200, sem cache, com versão, quando o banco responde", async () => {
    setup(async () => new Response("ok"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", version: { tag: "v2026.11.19", commit: "abc1234def56" }, db: "ok" });
  });

  it("503 sem detalhe do erro quando o banco cai", async () => {
    setup(async () => {
      throw new TypeError("connect ECONNREFUSED 10.1.2.3:3001");
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ status: "degraded", db: "unavailable" });
    expect(text).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|rest:3001|stack/);
  });
});
