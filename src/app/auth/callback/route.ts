import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getAuthConfig } from "@/server/auth/config";
import { onFirstLogin } from "@/server/auth/first-login";
import { completeSignIn } from "@/server/auth/flows";
import { LOGIN_PATH } from "@/server/auth/routes";
import { requestAuthClient } from "@/server/auth/session";

// Retorno do Google e do link mágico (#9): cria a sessão no cookie e segue para o destino.
export async function GET(request: NextRequest): Promise<never> {
  const config = getAuthConfig();
  if (!config) redirect(`${LOGIN_PATH}?erro=unavailable`);
  const auth = (await requestAuthClient(config)).auth;
  const result = await completeSignIn(auth, request.nextUrl.searchParams, onFirstLogin);
  redirect(result.ok ? result.next : `${LOGIN_PATH}?erro=${result.error}`);
}
