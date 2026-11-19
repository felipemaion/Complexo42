import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/server/auth/config";
import { parseAuthErrorCode } from "@/server/auth/errors";
import { LOGIN_PATH } from "@/server/auth/routes";
import { clearAuthCookies, requestAuthClient } from "@/server/auth/session";

// Encerra a sessão quando requireUser não pode deixar a pessoa seguir (#9, M2): perfil
// bloqueado ou falha na checagem de acesso. Um Server Component não grava cookie, então ele
// redireciona para cá. O "Sair" normal é a server action signOut (POST).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getAuthConfig();
  if (config) await (await requestAuthClient(config)).auth.signOut({ scope: "local" });
  await clearAuthCookies();
  const reason = parseAuthErrorCode(request.nextUrl.searchParams.get("motivo")) ?? "failed";
  return NextResponse.redirect(new URL(`${LOGIN_PATH}?erro=${reason}`, config?.siteUrl ?? request.url), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
