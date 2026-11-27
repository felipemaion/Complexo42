import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/server/auth/config";
import { startGoogleSignIn } from "@/server/auth/flows";
import { LOGIN_PATH } from "@/server/auth/routes";
import { requestAuthClient } from "@/server/auth/session";

const NO_STORE = { "Cache-Control": "private, no-store" };

function go(request: NextRequest, target: string): NextResponse {
  return NextResponse.redirect(new URL(target, getAuthConfig()?.siteUrl ?? request.url), { headers: NO_STORE });
}

// Início do "Entrar com Google" (#9). Tem de ser uma NAVEGAÇÃO do navegador (GET + 302), não uma
// server action: a action que redireciona para o /auth/v1/authorize da mesma origem faz o roteador
// do Next reenviar por POST, e o GoTrue responde 405. O PKCE nasce aqui (cookie do verificador).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getAuthConfig();
  if (!config) return go(request, `${LOGIN_PATH}?erro=unavailable`);
  // Endereço público: o navegador é mandado para <origem>/auth/v1/authorize.
  const auth = (await requestAuthClient(config, "public")).auth;
  const next = request.nextUrl.searchParams.get("next");
  const result = await startGoogleSignIn(auth, { siteUrl: config.siteUrl, ...(next ? { next } : {}) });
  return go(request, result.ok ? result.url : `${LOGIN_PATH}?erro=${result.error}`);
}
