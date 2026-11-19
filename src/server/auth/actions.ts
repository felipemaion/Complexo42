"use server";
// Server actions do login (#9). Os formulários de /entrar e /auth/confirmar postam aqui; nada
// de cliente Supabase no navegador. O e-mail digitado nunca volta para a URL nem para a tela.
import { redirect } from "next/navigation";
import { getAuthConfig } from "./config";
import { confirmMagicLink, requestMagicLink, startGoogleSignIn } from "./flows";
import { LOGIN_PATH } from "./routes";
import { accessRedirect, clearAuthCookies, requestAuthClient } from "./session";

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
  const result = await requestMagicLink(auth, { email: formData.get("email"), siteUrl: config.siteUrl });
  redirect(loginWith(result.ok ? "enviado=1" : `erro=${result.error}`));
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
