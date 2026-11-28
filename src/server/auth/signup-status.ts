// Estado do cadastro no Auth (#332). Com GOTRUE_DISABLE_SIGNUP (o compose do deploy), quem não tem
// conta não recebe link nenhum, e a resposta da tela continua a neutra (M4: não revela quem tem
// conta). O que a tela PODE dizer é o estado GLOBAL, igual para todos: "o cadastro está fechado".
// A fonte é o próprio Auth (/auth/v1/settings, público), e não uma variável a mais que divergiria dele.
import { log } from "@/server/log";
import type { AuthConfig } from "./config";

/** Tempo máximo de espera: o aviso é conforto, não pode atrasar a tela de login. */
const settingsTimeoutMs = 2000;
/** Quanto a resposta vale: a tela de login não chama o Auth (nem loga falha) a cada render. */
export const signupStatusTtlMs = 60_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Config = Pick<AuthConfig, "internalUrl" | "anonKey">;
export type SignupStatus = (config: Config | null, fetchImpl?: Fetch) => Promise<boolean>;

/** Pergunta ao Auth. True só quando ele diz, com certeza, que o cadastro está fechado; na dúvida, sem aviso. */
async function askAuth(config: Config, fetchImpl: Fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${config.internalUrl}/auth/v1/settings`, {
      headers: { apikey: config.anonKey },
      signal: AbortSignal.timeout(settingsTimeoutMs),
      cache: "no-store",
    });
    if (!res.ok) {
      log.warn("auth_settings_unavailable", { reason: `status_${res.status}` });
      return false;
    }
    const body: unknown = await res.json();
    const closed = typeof body === "object" && body !== null ? (body as { disable_signup?: unknown }).disable_signup : undefined;
    if (typeof closed !== "boolean") {
      log.warn("auth_settings_unavailable", { reason: "unexpected_body" });
      return false;
    }
    return closed;
  } catch {
    // Só o motivo, como código: a mensagem do erro de rede traz endereço interno.
    log.warn("auth_settings_unavailable", { reason: "request_failed" });
    return false;
  }
}

/** A falha também fica guardada pela janela: com o Auth fora, um aviso no log por janela, não um por render. */
export function createSignupStatus(opts: { ttlMs: number; now?: () => number }): SignupStatus {
  const now = opts.now ?? Date.now;
  let cached: { url: string; closed: boolean; expiresAt: number } | null = null;
  return async (config: Config | null, fetchImpl: Fetch = fetch): Promise<boolean> => {
    if (!config) return false;
    if (cached && cached.url === config.internalUrl && now() < cached.expiresAt) return cached.closed;
    const closed = await askAuth(config, fetchImpl);
    cached = { url: config.internalUrl, closed, expiresAt: now() + opts.ttlMs };
    return closed;
  };
}

export const isSignupClosed: SignupStatus = createSignupStatus({ ttlMs: signupStatusTtlMs });
