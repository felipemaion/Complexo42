import { NextResponse, type NextRequest } from "next/server";
import { exportOwnData, isSameOrigin, MY_DATA_STATUS_PARAM, type MyDataStatus } from "@/modules/privacy";
import { getAuthConfig } from "@/server/auth/config";
import { HOME_PATH } from "@/server/auth/routes";
import { requireAccessUserClient } from "@/server/auth/session";

// "Baixar meus dados" (#20). POST do botão da página inicial: devolve o JSON como anexo. Nada
// do conteúdo vai para log ou cache (R11). Sem sessão, manda para o login. Vale sem o aceite do termo: acesso e portabilidade não dependem dele (LGPD art. 18).
const NO_STORE = { "Cache-Control": "private, no-store" };

function backHome(request: NextRequest, status?: MyDataStatus): NextResponse {
  const base = getAuthConfig()?.siteUrl ?? request.url;
  const url = new URL(HOME_PATH, base);
  if (status) url.searchParams.set(MY_DATA_STATUS_PARAM, status);
  // 303: o navegador volta com GET (não reenvia o POST).
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getAuthConfig();
  if (!config || !isSameOrigin(request.headers.get("origin"), config.siteUrl)) {
    return new NextResponse(null, { status: 403, headers: NO_STORE });
  }
  const { user, client } = await requireAccessUserClient();
  // O e-mail inteiro só sai daqui, para o arquivo da própria pessoa (a sessão guarda só o
  // mascarado). Lido do GoTrue com o JWT dela.
  const { data } = await client.auth.getUser();
  const result = await exportOwnData(client, { id: user.id, email: data.user?.email ?? null });
  if (result.status === "rate_limited") return backHome(request, "limite");
  if (result.status === "failed") return backHome(request, "erro");
  return new NextResponse(result.body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Abrir o endereço direto (ou voltar do login) leva à página do botão. */
export function GET(request: NextRequest): NextResponse {
  return backHome(request);
}
