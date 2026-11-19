import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/server/auth/config";
import { exchangeCode } from "@/server/auth/flows";
import { CONFIRM_PATH, LOGIN_PATH } from "@/server/auth/routes";
import { accessRedirect, requestAuthClient } from "@/server/auth/session";

const NO_STORE = { "Cache-Control": "private, no-store" };

function go(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getAuthConfig()?.siteUrl ?? request.url), { headers: NO_STORE });
}

// Retorno do Google (#9): troca o code do PKCE pela sessão, passa pelo portão de acesso
// (lista de autorizados, #26) e segue para o destino. requireUser confere de novo em cada página.
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
  const client = await requestAuthClient(config);
  const result = await exchangeCode(client.auth, params);
  if (!result.ok) return go(request, `${LOGIN_PATH}?erro=${result.error}`);
  return go(request, (await accessRedirect(client, result.userId)) ?? result.next);
}
