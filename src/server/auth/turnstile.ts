// Cloudflare Turnstile no pedido do link por e-mail (#116). Impede que um robô dispare
// milhares de e-mails para terceiros e esgote a cota de envio, o que bloquearia o login de
// todo mundo. O token do widget é conferido aqui, no servidor, ANTES de pedir o link ao Auth.
//
// R11: o log leva só um código (ex.: "invalid-input-response"), nunca o token, o IP ou o e-mail.
import type { ServerEnv } from "@/server/env";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Nome do campo que o widget acrescenta ao formulário. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

// Chaves de TESTE oficiais e públicas da Cloudflare
// (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). Só valem fora de
// produção, quando a variável não foi definida. Não são segredo.
export const TURNSTILE_TEST_KEYS = {
  /** Site key que sempre passa (widget visível). */
  siteKeyPass: "1x00000000000000000000AA",
  /** Secret que sempre passa. */
  secretPass: "1x0000000000000000000000000000000AA",
  /** Secret que sempre falha. */
  secretFail: "2x0000000000000000000000000000000AA",
} as const;

export type TurnstileConfig = { siteKey: string; secretKey: string };

/** Em produção as duas chaves são obrigatórias (env.ts); fora dela, valem as de teste. */
export function turnstileConfigFrom(env: ServerEnv): TurnstileConfig {
  return {
    siteKey: env.TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_KEYS.siteKeyPass,
    secretKey: env.TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_KEYS.secretPass,
  };
}

export function getTurnstileConfig(): TurnstileConfig {
  return turnstileConfigFrom(getEnv());
}

/** Tamanho máximo documentado do token (2048 caracteres). */
const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 3000;

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

type VerifyOptions = {
  secretKey: string;
  /** IP do usuário; só quando confiável (TRUST_CF_CONNECTING_IP). */
  remoteIp?: string | null;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

// Códigos da Cloudflare têm formato fixo; qualquer outra coisa vira "unknown" antes do log.
const errorCode = (raw: unknown): string => (typeof raw === "string" && /^[a-z-]{1,64}$/.test(raw) ? raw : "unknown");

/**
 * Confere o token no siteverify. Falha fechado: token ausente, recusado, resposta estranha,
 * erro de rede ou demora acima do limite dão `ok: false`.
 */
export async function verifyTurnstile(token: unknown, opts: VerifyOptions): Promise<TurnstileResult> {
  const fail = (reason: string): TurnstileResult => {
    log.warn("auth_turnstile_failed", { reason });
    return { ok: false, reason };
  };
  if (typeof token !== "string" || token.length === 0) return fail("missing-input-response");
  if (token.length > MAX_TOKEN_LENGTH) return fail("invalid-input-response");

  const body = new URLSearchParams({ secret: opts.secretKey, response: token });
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await (opts.fetch ?? fetch)(SITEVERIFY_URL, { method: "POST", body, signal: controller.signal, cache: "no-store" });
    if (!res.ok) return fail(`http-${res.status}`);
    const data = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
    if (data.success === true) return { ok: true };
    const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
    return fail(errorCode(codes[0]));
  } catch (error) {
    return fail(controller.signal.aborted ? "timeout" : error instanceof SyntaxError ? "bad-response" : "network-error");
  } finally {
    clearTimeout(timer);
  }
}
