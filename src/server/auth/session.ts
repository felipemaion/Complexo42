import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { accessStatuses, type AccessStatus } from "@/modules/profiles";
import { log } from "@/server/log";
import { checkAccess } from "./access";
import { AUTH_COOKIE_NAME, createAuthClient, hasAuthCookie, type AuthClient } from "./client";
import { getAuthConfig, type AuthConfig } from "./config";
import { consentRedirect } from "./consent";
import { onFirstLogin } from "./first-login";
import { maskEmail } from "./mask";
import { LOGIN_PATH, SIGNOUT_PATH, WAITLIST_PATH } from "./routes";

// Sessão nas páginas, server actions e rotas (#9). O cliente usa a chave anon + o JWT do
// usuário que está no cookie: a RLS continua valendo (R14).

/** Cliente de auth da requisição atual. `via: "public"` só para montar o endereço do Google. */
export async function requestAuthClient(config: AuthConfig, via: "internal" | "public" = "internal"): Promise<AuthClient> {
  const store = await cookies();
  // Rate limit por IP no GoTrue (ADR 0009 §6): sem isto, todo pedido feito pelo servidor
  // pareceria vir do mesmo IP. Só com TRUST_CF_CONNECTING_IP: o cabeçalho só é confiável se
  // apenas a Cloudflare alcança a origem (garantia do servidor, #86).
  const ip = config.trustCfConnectingIp ? (await headers()).get("cf-connecting-ip") : null;
  return createAuthClient({
    url: via === "public" ? config.publicUrl : config.internalUrl,
    anonKey: config.anonKey,
    secure: config.siteUrl.startsWith("https:"),
    ...(ip ? { headers: { "CF-Connecting-IP": ip } } : {}),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component não grava cookie; o proxy já renovou a sessão nesta requisição.
        }
      },
    },
  });
}

export type CurrentUser = { id: string; maskedEmail: string };
type Session = { client: AuthClient; user: CurrentUser } | null;

/** Sessão conferida no GoTrue (não só o cookie). Uma vez por requisição. */
const getSession = cache(async (): Promise<Session> => {
  // cookies() antes de tudo: torna a página dinâmica (nada de pré-renderizar no build).
  const store = await cookies();
  const config = getAuthConfig();
  if (!config || !hasAuthCookie(store.getAll().map((c) => c.name))) return null;
  const client = await requestAuthClient(config);
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  // Só a versão mascarada sai daqui: o e-mail inteiro nunca chega à tela.
  return { client, user: { id: data.user.id, maskedEmail: maskEmail(data.user.email ?? "") } };
});

const statusRow = z.object({ access_status: z.enum(accessStatuses) }).nullable();

async function readAccessStatus(client: AuthClient, userId: string): Promise<AccessStatus | null> {
  const { data, error } = await client.from("profiles").select("access_status").eq("id", userId).maybeSingle();
  if (error) throw new Error(`profile_read_failed:${error.code ?? "unknown"}`);
  return statusRow.parse(data)?.access_status ?? null;
}

/**
 * Sessão + portão de acesso (M2), SEM o portão do termo: só a tela do termo (#11) usa esta.
 * `pending`/sem perfil chama o gancho do primeiro login; `waitlisted` vai para a espera;
 * `blocked` e qualquer falha encerram a sessão.
 */
export const requireAccessUser = cache(async (): Promise<CurrentUser> => {
  const session = await getSession();
  if (!session) redirect(LOGIN_PATH);
  const blocked = await accessRedirect(session.client, session.user.id);
  if (blocked) redirect(blocked);
  return session.user;
});

/** Como `requireAccessUser`, com o cliente da pessoa (R14). Para o termo e o seu aceite. */
export async function requireAccessUserClient(): Promise<{ user: CurrentUser; client: AuthClient }> {
  const user = await requireAccessUser();
  const session = await getSession();
  if (!session) redirect(LOGIN_PATH);
  return { user, client: session.client };
}

/**
 * Para toda página autenticada (o proxy já redireciona; isto é a segunda barreira): o portão de
 * acesso de `requireAccessUser` e, depois dele, o termo de consentimento (#11): quem não aceitou
 * a versão atual vai para a tela do termo.
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const user = await requireAccessUser();
  const session = await getSession();
  if (!session) redirect(LOGIN_PATH);
  const pending = await consentRedirect(session.client, user.id);
  if (pending) redirect(pending);
  return user;
});

/**
 * Igual a `requireUser`, mas devolve também o cliente do Supabase com o JWT da pessoa (R14),
 * para as páginas e server actions que leem ou gravam dados dela. Nunca `service_role`.
 */
export async function requireUserClient(): Promise<{ user: CurrentUser; client: AuthClient }> {
  const user = await requireUser();
  const session = await getSession();
  if (!session) redirect(LOGIN_PATH);
  return { user, client: session.client };
}

/**
 * Portão de acesso logo depois do login (callback e confirmação do link) e em requireUser.
 * Devolve para onde mandar a pessoa quando ela não pode seguir, ou null se pode.
 */
export async function accessRedirect(client: AuthClient, userId: string): Promise<string | null> {
  let decision;
  try {
    decision = await checkAccess({
      readStatus: () => readAccessStatus(client, userId),
      resolve: () => onFirstLogin(client),
    });
  } catch (err) {
    // Só o código: a mensagem do erro nunca leva e-mail (R11), mas não arriscamos.
    const code = err instanceof Error ? ((err as { code?: unknown }).code ?? err.message.split(":")[0]) : "unknown";
    log.error("auth_access_check_failed", { reason: String(code).slice(0, 64) });
    return `${SIGNOUT_PATH}?motivo=failed`;
  }
  if (decision === "waitlist") return WAITLIST_PATH;
  if (decision === "blocked") return `${SIGNOUT_PATH}?motivo=blocked`;
  return null;
}

/**
 * Para a exclusão da conta (#18): a sessão conferida no GoTrue, SEM o portão de acesso. Quem
 * está na espera, ou ainda não tem perfil, também tem o direito de excluir (LGPD art. 18, VI).
 * Devolve o access token da sessão só para a tela saber a hora do login; quem decide é o banco,
 * com o mesmo JWT. Nunca `service_role`.
 */
export async function requireSessionClient(): Promise<{ client: AuthClient; accessToken: string | null }> {
  const session = await getSession();
  if (!session) redirect(LOGIN_PATH);
  const { data } = await session.client.auth.getSession();
  return { client: session.client, accessToken: data.session?.access_token ?? null };
}

/** Encerra a sessão neste aparelho (cookies apagados mesmo se o GoTrue não responder). */
export async function endSession(): Promise<void> {
  const config = getAuthConfig();
  try {
    if (config) await (await requestAuthClient(config)).auth.signOut({ scope: "local" });
  } finally {
    await clearAuthCookies();
  }
}

/** Apaga os cookies de sessão mesmo se o GoTrue não responder ao logout. */
export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) if (name.startsWith(AUTH_COOKIE_NAME)) store.delete(name);
}
