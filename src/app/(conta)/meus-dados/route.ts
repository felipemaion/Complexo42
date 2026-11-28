import { NextResponse, type NextRequest } from "next/server";
import { exportOwnData, isSameOrigin, MY_DATA_STATUS_PARAM, type MyDataStatus } from "@/modules/privacy";
import { getAuthConfig } from "@/server/auth/config";
import { HOME_PATH, WAITLIST_PATH } from "@/server/auth/routes";
import { requireHolderClient } from "@/server/auth/session";

// "Baixar meus dados" (#20). POST do botão da página inicial (ou de /espera, #130): devolve o JSON como anexo. Nada
// do conteúdo vai para log ou cache (R11). Sem sessão, manda para o login. Vale sem o aceite do termo e para quem
// está em espera: acesso e portabilidade não dependem deles (LGPD art. 18). Só a sessão é exigida.
const NO_STORE = { "Cache-Control": "private, no-store" };

/** De onde veio o pedido: o destino de volta é uma lista fechada, nunca um endereço que o navegador mande. */
const BACK_TARGETS: Record<string, string> = { espera: WAITLIST_PATH };

function backTo(request: NextRequest, status?: MyDataStatus, back?: string): NextResponse {
  const base = getAuthConfig()?.siteUrl ?? request.url;
  const url = new URL((back && BACK_TARGETS[back]) || HOME_PATH, base);
  if (status) url.searchParams.set(MY_DATA_STATUS_PARAM, status);
  // 303: o navegador volta com GET (não reenvia o POST).
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getAuthConfig();
  if (!config || !isSameOrigin(request.headers.get("origin"), config.siteUrl, request.headers.get("sec-fetch-site"))) {
    return new NextResponse(null, { status: 403, headers: NO_STORE });
  }
  const { user, client } = await requireHolderClient();
  // "volta": de qual tela veio o botão, para o aviso de limite ou erro aparecer nela. Sem corpo de formulário, é o início.
  const form = await request.formData().catch(() => null);
  const back = typeof form?.get("volta") === "string" ? (form.get("volta") as string) : undefined;
  // O e-mail inteiro só sai daqui, para o arquivo da própria pessoa (a sessão guarda só o
  // mascarado). Lido do GoTrue com o JWT dela.
  const { data } = await client.auth.getUser();
  const result = await exportOwnData(client, { id: user.id, email: data.user?.email ?? null });
  if (result.status === "rate_limited") return backTo(request, "limite", back);
  if (result.status === "failed") return backTo(request, "erro", back);
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
  return backTo(request);
}
