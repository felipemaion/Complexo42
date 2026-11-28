import { describe, expect, it, vi } from "vitest";
import { probeSchema } from "./probe-schema";

const BASE = "http://kong:8000";
const CHAVE = "sb_publishable_teste";

/** Corpos reais, medidos no staging em 2026-11-28. */
const PGRST205 = JSON.stringify({
  code: "PGRST205",
  details: null,
  hint: null,
  message: "Could not find the table 'public.profiles' in the schema cache",
});
const SEM_PRIVILEGIO = JSON.stringify({ code: "42501", details: null, hint: null, message: "permission denied" });

describe("probeSchema", () => {
  it("ok quando a leitura responde 2xx", async () => {
    expect(await probeSchema(BASE, CHAVE, 1000, async () => new Response("[]"))).toEqual({ status: "ok" });
  });

  it("ok com 401/42501: privilegio recusado prova que o esquema foi resolvido", async () => {
    const res = await probeSchema(BASE, CHAVE, 1000, async () => new Response(SEM_PRIVILEGIO, { status: 401 }));
    expect(res).toEqual({ status: "ok" });
  });

  it("stale com 404/PGRST205 -- a falha que isto existe para pegar", async () => {
    const res = await probeSchema(BASE, CHAVE, 1000, async () => new Response(PGRST205, { status: 404 }));
    expect(res).toEqual({ status: "stale" });
  });

  it("404 sem o codigo do PostgREST nao e stale: e indisponivel", async () => {
    const res = await probeSchema(BASE, CHAVE, 1000, async () => new Response("<html>404</html>", { status: 404 }));
    expect(res).toEqual({ status: "unavailable", reason: "http_error" });
  });

  it("401 do Kong (sem corpo do PostgREST) nao passa por ok", async () => {
    const kong = JSON.stringify({ message: "No API key found in request" });
    const res = await probeSchema(BASE, CHAVE, 1000, async () => new Response(kong, { status: 401 }));
    expect(res).toEqual({ status: "unavailable", reason: "http_error" });
  });

  it("indisponivel quando a conexao e recusada", async () => {
    const res = await probeSchema(BASE, CHAVE, 1000, async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.5:8000");
    });
    expect(res).toEqual({ status: "unavailable", reason: "network" });
  });

  it("indisponivel por timeout", async () => {
    const trava = (_: string, init: RequestInit) =>
      new Promise<Response>((_r, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    expect(await probeSchema(BASE, CHAVE, 20, trava)).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it("sem URL ou sem chave, nao chama a rede", async () => {
    const explode = async () => {
      throw new Error("nao devia chamar");
    };
    expect(await probeSchema(undefined, CHAVE, 1000, explode)).toEqual({ status: "unconfigured" });
    expect(await probeSchema(BASE, undefined, 1000, explode)).toEqual({ status: "unconfigured" });
  });

  it("vai pelo caminho real: a tabela que o login le, uma linha, com a chave anon", async () => {
    const espiao = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response("[]")),
    );
    // A barra sobrando na base tem de ser normalizada: `${base}/` + `/rest/v1`
    // daria `//rest/v1`, que o Kong trata como outro caminho.
    await probeSchema(`${BASE}/`, CHAVE, 1000, espiao);
    const chamada = espiao.mock.calls[0];
    expect(chamada).toBeDefined();
    const [url, init] = chamada!;
    expect(url).toBe("http://kong:8000/rest/v1/profiles?select=id&limit=1");
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe(CHAVE);
    expect(headers.Authorization).toBe(`Bearer ${CHAVE}`);
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
  });
});
