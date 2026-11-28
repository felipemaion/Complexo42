// Estado GLOBAL do cadastro (#332): o login avisa quando o cadastro está fechado, para todo mundo e
// sempre igual, sem depender do e-mail digitado (a resposta do link continua a neutra, M4).
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "@/server/log";
import { createSignupStatus, signupStatusTtlMs } from "./signup-status";

const config = { internalUrl: "http://kong:8000", anonKey: "chave-anon-de-teste" };
const settings = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.restoreAllMocks());

// Sem cache nos casos de comportamento: cada chamada pergunta ao Auth.
const isSignupClosed = createSignupStatus({ ttlMs: 0 });

describe("isSignupClosed", () => {
  it("cadastro fechado no Auth (disable_signup) → true", async () => {
    expect(await isSignupClosed(config, settings({ disable_signup: true }))).toBe(true);
  });

  it("cadastro aberto → false", async () => {
    expect(await isSignupClosed(config, settings({ disable_signup: false }))).toBe(false);
  });

  it("pergunta ao Auth pela rede interna, com a chave anon", async () => {
    const fetchImpl = settings({ disable_signup: true });
    await isSignupClosed(config, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://kong:8000/auth/v1/settings");
    expect(new Headers(init.headers).get("apikey")).toBe("chave-anon-de-teste");
  });

  it("Auth fora do ar, resposta de erro ou corpo estranho → false (sem aviso) e registro no log", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED 10.0.0.1");
    });
    expect(await isSignupClosed(config, down)).toBe(false);
    expect(await isSignupClosed(config, settings({ disable_signup: true }, 503))).toBe(false);
    expect(await isSignupClosed(config, settings({ disable_signup: "sim" }))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    // O detalhe técnico não vai para o log: só o motivo, como código.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("10.0.0.1");
  });

  it("sem login configurado (fora de produção) → false, sem chamar a rede", async () => {
    const fetchImpl = settings({ disable_signup: true });
    expect(await isSignupClosed(null, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("guarda a resposta por um tempo: um render não chama o Auth nem loga a cada vez", async () => {
    let agora = 1_000_000;
    const check = createSignupStatus({ ttlMs: signupStatusTtlMs, now: () => agora });
    const fetchImpl = settings({ disable_signup: true });
    expect(await check(config, fetchImpl)).toBe(true);
    agora += signupStatusTtlMs - 1;
    expect(await check(config, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    agora += 2;
    await check(config, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a falha também fica guardada: com o Auth fora, um aviso no log por janela, não um por render", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const check = createSignupStatus({ ttlMs: signupStatusTtlMs, now: () => 5 });
    const down = vi.fn(async () => {
      throw new Error("fora");
    });
    for (let i = 0; i < 5; i++) expect(await check(config, down)).toBe(false);
    expect(down).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a janela fica entre 30 e 60 s", () => {
    expect(signupStatusTtlMs).toBeGreaterThanOrEqual(30_000);
    expect(signupStatusTtlMs).toBeLessThanOrEqual(60_000);
  });
});
