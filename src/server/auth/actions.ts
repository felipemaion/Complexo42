"use server";
// Server actions do login (#9). Os formulários de /entrar e /auth/confirmar postam aqui; nada
// de cliente Supabase no navegador. O e-mail digitado nunca volta para a URL nem para a tela.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthConfig } from "./config";
import { confirmMagicLink, requestMagicLink, startGoogleSignIn } from "./flows";
import { requestPasswordRecovery, signInWithPassword } from "./password-flows";
import { LOGIN_PATH } from "./routes";
import { accessRedirect, clearAuthCookies, requestAuthClient } from "./session";
import { getTurnstileConfig, TURNSTILE_FIELD, verifyTurnstile } from "./turnstile";

const loginWith = (query: string) => `${LOGIN_PATH}?${query}`;

export async function signInWithGoogle(formData: FormData): Promise<never> {
  const config = getAuthConfig();
  if (!config) redirect(loginWith("erro=unavailable"));
  // Endereço público: o navegador é mandado para <origem>/auth/v1/authorize.
  const auth = (await requestAuthClient(config, "public")).auth;
  const next = formData.get("next");
  const result = await startGoogleSignIn(auth, { siteUrl: config.siteUrl, ...(typeof next === "string" ? { next } : {}) });
  redirect(result.ok ? result.url : loginWith(`erro=${result.error}`));
}

export async function sendMagicLink(formData: FormData): Promise<never> {
  const config = getAuthConfig();
  // Mesmo sem Auth configurado, a resposta é a neutra (M4); o motivo vai para o log no fluxo.
  if (!config) redirect(loginWith("enviado=1"));
  const auth = (await requestAuthClient(config)).auth;
  // Turnstile (#116): o IP vai junto só quando confiável (mesma regra do rate limit do Auth).
  const remoteIp = config.trustCfConnectingIp ? (await headers()).get("cf-connecting-ip") : null;
  const verifyHuman = () => verifyTurnstile(formData.get(TURNSTILE_FIELD), { secretKey: getTurnstileConfig().secretKey, remoteIp });
  const result = await requestMagicLink(auth, { email: formData.get("email"), siteUrl: config.siteUrl, verifyHuman });
  redirect(loginWith(result.ok ? "enviado=1" : `erro=${result.error}`));
}

/** Entrar com e-mail e senha (ADR 0018). Mesma resposta para qualquer falha; o acesso passa pelo portão de sempre. */
export async function signInWithPasswordAction(formData: FormData): Promise<never> {
  const config = getAuthConfig();
  if (!config) redirect(loginWith("erro=unavailable"));
  const client = await requestAuthClient(config);
  const remoteIp = config.trustCfConnectingIp ? (await headers()).get("cf-connecting-ip") : null;
  const verifyHuman = () => verifyTurnstile(formData.get(TURNSTILE_FIELD), { secretKey: getTurnstileConfig().secretKey, remoteIp });
  const result = await signInWithPassword(client.auth, { email: formData.get("email"), password: formData.get("password"), next: formData.get("next"), verifyHuman });
  if (!result.ok) redirect(loginWith(`erro=${result.error}`));
  redirect((await accessRedirect(client, result.userId)) ?? result.next);
}

/** "Esqueci a senha": o link leva a /senha, onde a pessoa cria a nova. Resposta neutra, como a do link de entrada. */
export async function sendPasswordRecoveryAction(formData: FormData): Promise<never> {
  const config = getAuthConfig();
  if (!config) redirect(loginWith("enviado=2"));
  const auth = (await requestAuthClient(config)).auth;
  const remoteIp = config.trustCfConnectingIp ? (await headers()).get("cf-connecting-ip") : null;
  const verifyHuman = () => verifyTurnstile(formData.get(TURNSTILE_FIELD), { secretKey: getTurnstileConfig().secretKey, remoteIp });
  const result = await requestPasswordRecovery(auth, { email: formData.get("email"), siteUrl: config.siteUrl, verifyHuman });
  redirect(loginWith(result.ok ? "enviado=2" : `erro=${result.error}`));
}

/**
 * Um formulário só em /entrar (um Turnstile só, #116) com três botões: cada um manda o seu
 * `intent`. O despacho é aqui (uma ação só no formulário) e não em `formAction` por botão: o
 * resultado não depende de como o navegador trata o `formAction` de cada botão. Sem intent
 * conhecido, vale o link por e-mail, que não faz nada além de mandar o e-mail.
 */
export async function submitLoginForm(formData: FormData): Promise<never> {
  const intent = formData.get("intent");
  if (intent === "password") return signInWithPasswordAction(formData);
  if (intent === "recover") return sendPasswordRecoveryAction(formData);
  return sendMagicLink(formData);
}

/** POST do botão "Entrar" da página do link mágico: só aqui o token é gasto. */
export async function confirmMagicLinkAction(formData: FormData): Promise<never> {
  const config = getAuthConfig();
  if (!config) redirect(loginWith("erro=unavailable"));
  const client = await requestAuthClient(config);
  const result = await confirmMagicLink(client.auth, { token_hash: formData.get("token_hash"), type: formData.get("type") });
  if (!result.ok) redirect(loginWith(`erro=${result.error}`));
  // Portão de acesso (lista de autorizados, #26) antes de seguir.
  redirect((await accessRedirect(client, result.userId)) ?? result.next);
}

export async function signOut(): Promise<never> {
  const config = getAuthConfig();
  if (config) await (await requestAuthClient(config)).auth.signOut({ scope: "local" });
  await clearAuthCookies();
  redirect(loginWith("saiu=1"));
}
