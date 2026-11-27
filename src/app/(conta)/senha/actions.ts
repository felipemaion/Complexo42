"use server";
// Server actions da senha (ADR 0018). Só composição: sessão + fluxos de `password-flows`. A senha
// chega por POST e vai direto ao Auth com o JWT da pessoa; nunca para a URL, o log ou o estado do
// cliente (R11). O resultado volta como código curto em `?s=`, lido só contra uma lista fixa.
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { removeOwnPassword, setOwnPassword, usesGoogleSignIn, type SetPasswordError } from "@/server/auth/password-flows";
import { LOGIN_PATH, PASSWORD_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";
import { PASSWORD_STATUS_PARAM, type PasswordStatus } from "./status";

const back = (status: PasswordStatus) => `${PASSWORD_PATH}?${PASSWORD_STATUS_PARAM}=${status}`;

/** A sessão e o fato de a conta entrar pelo Google (quem entra por ele não usa senha). */
async function sessionForPassword() {
  const { client } = await requireUserClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect(LOGIN_PATH);
  if (usesGoogleSignIn(data.user)) redirect(back("google"));
  return client.auth;
}

function currentPasswordOf(formData: FormData): string | undefined {
  const value = formData.get("current_password");
  return typeof value === "string" && value !== "" ? value : undefined;
}

const finish = (result: { ok: true } | { ok: false; error: SetPasswordError }, done: PasswordStatus): never =>
  redirect(back(result.ok ? done : result.error));

export async function setPasswordAction(formData: FormData): Promise<never> {
  const auth = await sessionForPassword();
  const currentPassword = currentPasswordOf(formData);
  const result = await setOwnPassword(auth, {
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
    ...(currentPassword ? { currentPassword } : {}),
  });
  return finish(result, "saved");
}

export async function removePasswordAction(formData: FormData): Promise<never> {
  const auth = await sessionForPassword();
  const currentPassword = currentPasswordOf(formData);
  // 32 bytes aleatórios que ninguém vê: o GoTrue não remove senha (ADR 0018 §6).
  const result = await removeOwnPassword(auth, { generate: () => randomBytes(32).toString("base64url"), ...(currentPassword ? { currentPassword } : {}) });
  return finish(result, "removed");
}
