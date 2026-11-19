import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: string[] = [];
vi.mock("@/server/log", () => {
  const write = (event: string, fields?: object) => void logged.push(JSON.stringify({ event, ...fields }));
  return { log: { info: write, warn: write, error: write } };
});

const { SITEVERIFY_URL, TURNSTILE_TEST_KEYS, turnstileConfigFrom, verifyTurnstile } = await import("./turnstile");
const { parseEnv } = await import("@/server/env");

// Token fictício de baixa entropia; o dummy oficial do widget de teste tem o mesmo formato.
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SECRET = TURNSTILE_TEST_KEYS.secretPass;

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const sentBody = (fetchMock: ReturnType<typeof vi.fn>) => new URLSearchParams((fetchMock.mock.calls[0]?.[1] as RequestInit).body as URLSearchParams);

beforeEach(() => {
  logged.length = 0;
});

describe("verifyTurnstile (#116)", () => {
  it("passa quando o siteverify confirma; envia secret e response por POST", async () => {
    const fetchMock = reply({ success: true });
    expect(await verifyTurnstile(TOKEN, { secretKey: SECRET, fetch: fetchMock })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(SITEVERIFY_URL, expect.objectContaining({ method: "POST" }));
    const body = sentBody(fetchMock);
    expect(body.get("secret")).toBe(SECRET);
    expect(body.get("response")).toBe(TOKEN);
    expect(body.has("remoteip")).toBe(false);
  });

  it("manda remoteip só quando recebe um IP (confiável)", async () => {
    const fetchMock = reply({ success: true });
    await verifyTurnstile(TOKEN, { secretKey: SECRET, remoteIp: "203.0.113.7", fetch: fetchMock });
    expect(sentBody(fetchMock).get("remoteip")).toBe("203.0.113.7");
  });

  it("falha quando o siteverify recusa (chave que sempre falha); loga só o código", async () => {
    const fetchMock = reply({ success: false, "error-codes": ["invalid-input-response"] });
    const result = await verifyTurnstile(TOKEN, { secretKey: TURNSTILE_TEST_KEYS.secretFail, fetch: fetchMock });
    expect(result).toEqual({ ok: false, reason: "invalid-input-response" });
    expect(logged).toEqual([JSON.stringify({ event: "auth_turnstile_failed", reason: "invalid-input-response" })]);
    expect(logged.join()).not.toContain(TOKEN);
  });

  it("código de erro fora do formato não vai cru para o log", async () => {
    const result = await verifyTurnstile(TOKEN, { secretKey: SECRET, fetch: reply({ success: false, "error-codes": ["<b>x@y.z</b>"] }) });
    expect(result).toEqual({ ok: false, reason: "unknown" });
  });

  it.each([[undefined], [null], [""], [42]])("token ausente (%j): falha sem chamar a rede", async (token) => {
    const fetchMock = reply({ success: true });
    expect(await verifyTurnstile(token, { secretKey: SECRET, fetch: fetchMock })).toEqual({ ok: false, reason: "missing-input-response" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token grande demais: falha sem chamar a rede", async () => {
    const fetchMock = reply({ success: true });
    expect((await verifyTurnstile("x".repeat(2049), { secretKey: SECRET, fetch: fetchMock })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("siteverify fora do ar (erro de rede): falha fechado", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await verifyTurnstile(TOKEN, { secretKey: SECRET, fetch: fetchMock })).toEqual({ ok: false, reason: "network-error" });
  });

  it("siteverify com HTTP 5xx ou resposta que não é JSON: falha fechado", async () => {
    expect(await verifyTurnstile(TOKEN, { secretKey: SECRET, fetch: reply({}, 503) })).toEqual({ ok: false, reason: "http-503" });
    const notJson = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await verifyTurnstile(TOKEN, { secretKey: SECRET, fetch: notJson })).toEqual({ ok: false, reason: "bad-response" });
    expect((await verifyTurnstile(TOKEN, { secretKey: SECRET, fetch: reply({ success: "true" }) })).ok).toBe(false);
  });

  it("siteverify lento: aborta no limite de tempo e falha fechado", async () => {
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    expect(await verifyTurnstile(TOKEN, { secretKey: SECRET, timeoutMs: 20, fetch: hang })).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("turnstileConfigFrom (#116)", () => {
  it("fora de produção, sem variável, usa as chaves de teste que sempre passam", () => {
    const result = parseEnv({ NODE_ENV: "development" });
    expect(result.ok && turnstileConfigFrom(result.env)).toEqual({ siteKey: TURNSTILE_TEST_KEYS.siteKeyPass, secretKey: TURNSTILE_TEST_KEYS.secretPass });
  });

  it("usa as chaves do ambiente quando definidas", () => {
    const site = `0x${"a".repeat(22)}`;
    const result = parseEnv({ NODE_ENV: "development", TURNSTILE_SITE_KEY: site, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.secretFail });
    expect(result.ok && turnstileConfigFrom(result.env)).toEqual({ siteKey: site, secretKey: TURNSTILE_TEST_KEYS.secretFail });
  });
});
