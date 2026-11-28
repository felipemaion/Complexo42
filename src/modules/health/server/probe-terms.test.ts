import { describe, expect, it, vi } from "vitest";
import { probeTerms } from "./probe-terms";

const BASE = "http://kong:8000";
const CHAVE = "sb_publishable_teste";
const versions = { questionnaire: "termo-secreto-9", general: "v7" };
const resposta = (valor: string) => new Response(JSON.stringify(valor));

describe("probeTerms (#222)", () => {
  it("ok quando o banco confirma as duas versões", async () => {
    expect(await probeTerms(BASE, CHAVE, versions, 1000, async () => resposta("ok"))).toEqual({ status: "ok" });
  });

  it("degraded: o banco não tem a versão da config (sem dizer qual)", async () => {
    expect(await probeTerms(BASE, CHAVE, versions, 1000, async () => resposta("degraded"))).toEqual({ status: "degraded" });
  });

  it("chama a função pública por POST, com a chave anon e as duas versões no corpo", async () => {
    const fetchImpl = vi.fn(async () => resposta("ok"));
    await probeTerms(`${BASE}/`, CHAVE, versions, 1000, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/v1/rpc/term_versions_check`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ p_questionnaire: "termo-secreto-9", p_general: "v7" });
    expect(init.headers).toMatchObject({ apikey: CHAVE, "Content-Type": "application/json" });
  });

  it("resposta inesperada, erro HTTP (função ausente: cache velho) ou rede caída: unavailable, sem detalhe", async () => {
    expect(await probeTerms(BASE, CHAVE, versions, 1000, async () => resposta("outra-coisa"))).toEqual({ status: "unavailable", reason: "http_error" });
    expect(await probeTerms(BASE, CHAVE, versions, 1000, async () => new Response("{}", { status: 404 }))).toEqual({ status: "unavailable", reason: "http_error" });
    expect(await probeTerms(BASE, CHAVE, versions, 1000, async () => { throw new TypeError("ECONNREFUSED"); })).toEqual({ status: "unavailable", reason: "network" });
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(await probeTerms(BASE, CHAVE, versions, 1000, async () => { throw timeout; })).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it("sem URL, chave ou versões: unconfigured", async () => {
    expect(await probeTerms(undefined, CHAVE, versions, 1000)).toEqual({ status: "unconfigured" });
    expect(await probeTerms(BASE, undefined, versions, 1000)).toEqual({ status: "unconfigured" });
    expect(await probeTerms(BASE, CHAVE, undefined, 1000)).toEqual({ status: "unconfigured" });
  });
});
