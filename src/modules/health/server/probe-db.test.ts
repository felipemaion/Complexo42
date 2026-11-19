import { describe, expect, it } from "vitest";
import { probeDb } from "./probe-db";

const URL = "http://rest:3001/ready";

describe("probeDb", () => {
  it("ok quando a URL responde 2xx", async () => {
    expect(await probeDb(URL, 1000, async () => new Response("ok"))).toEqual({ status: "ok" });
  });

  it("indisponível quando o banco responde 503", async () => {
    const res = await probeDb(URL, 1000, async () => new Response("", { status: 503 }));
    expect(res).toEqual({ status: "unavailable", reason: "http_error" });
  });

  it("indisponível quando a conexão é recusada", async () => {
    const res = await probeDb(URL, 1000, async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.5:3001");
    });
    expect(res).toEqual({ status: "unavailable", reason: "network" });
  });

  it("indisponível por timeout quando o banco não responde", async () => {
    const hang = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    expect(await probeDb(URL, 20, hang)).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it("sem configuração, não chama a rede", async () => {
    const res = await probeDb(undefined, 1000, async () => {
      throw new Error("não devia chamar");
    });
    expect(res).toEqual({ status: "unconfigured" });
  });
});
