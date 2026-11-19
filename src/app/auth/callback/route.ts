import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/server/auth/config";
import { exchangeCode } from "@/server/auth/flows";
import { CONFIRM_PATH, LOGIN_PATH } from "@/server/auth/routes";
import { requestAuthClient } from "@/server/auth/session";

const NO_STORE = { "Cache-Control": "private, no-store" };

function go(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getAuthConfig()?.siteUrl ?? request.url), { headers: NO_STORE });
}

// Retorno do Google (#9): troca o code do PKCE pela sessão e segue para o destino. A decisão de
// acesso acontece em requireUser, na página de destino.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  // Link mágico antigo apontando para cá: nunca verificar no GET (M1/M5); manda para a página
  // intermediária, onde o login só acontece no clique.
  if (params.has("token_hash")) {
    const confirm = new URLSearchParams({ token_hash: params.get("token_hash") ?? "", type: params.get("type") ?? "" });
    return go(request, `${CONFIRM_PATH}?${confirm}`);
  }
  const config = getAuthConfig();
  if (!config) return go(request, `${LOGIN_PATH}?erro=unavailable`);
  const auth = (await requestAuthClient(config)).auth;
  const result = await exchangeCode(auth, params);
  return go(request, result.ok ? result.next : `${LOGIN_PATH}?erro=${result.error}`);
}
