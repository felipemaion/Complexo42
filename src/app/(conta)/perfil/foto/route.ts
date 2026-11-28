import { NextResponse, type NextRequest } from "next/server";
import { instance } from "@config/instance";
import { isSameOrigin } from "@/modules/privacy";
import { PHOTO_STATUS_PARAM, photoLimits, readBodyCapped, savePhoto, type PhotoStatus, type SavePhotoResult } from "@/modules/profiles";
import { getAuthConfig } from "@/server/auth/config";
import { PROFILE_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

// Envio da foto do perfil (#308). POST do formulário de /perfil, atrás da chave `profile.photoEnabled`
// (desligada por padrão: 404, como se a rota não existisse). Só do mesmo site; o corpo é limitado a
// 2 MB (mais o envelope) ANTES de ler tudo; a imagem só existe em memória e vira miniatura no serviço.
// A resposta é sempre um redirect (303) para o perfil com o resultado em `?foto=`. Nada da imagem em log (R11).
const NO_STORE = { "Cache-Control": "private, no-store" };

const statusOf: Record<SavePhotoResult["status"], PhotoStatus> = {
  saved: "ok",
  invalid_type: "tipo",
  too_large: "grande",
  unreadable: "ilegivel",
  too_many_attempts: "limite",
  forbidden: "erro",
  failed: "erro",
};

function backToProfile(request: NextRequest, status: PhotoStatus): NextResponse {
  const url = new URL(PROFILE_PATH, getAuthConfig()?.siteUrl ?? request.url);
  url.searchParams.set(PHOTO_STATUS_PARAM, status);
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!instance.profile.photoEnabled) return new NextResponse(null, { status: 404, headers: NO_STORE });
  const config = getAuthConfig();
  if (!config || !isSameOrigin(request.headers.get("origin"), config.siteUrl)) {
    return new NextResponse(null, { status: 403, headers: NO_STORE });
  }
  const maxBody = photoLimits.maxUploadBytes + photoLimits.bodyOverheadBytes;
  // Tamanho declarado grande demais: recusa sem ler nada do corpo.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBody) return backToProfile(request, "grande");

  const { user, client } = await requireUserClient();
  // O declarado pode faltar ou mentir: a leitura em si também para no limite.
  const body = await readBodyCapped(request.body, maxBody);
  if (body === null) return backToProfile(request, "grande");

  let file: FormDataEntryValue | null;
  try {
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    file = form.get("photo");
  } catch {
    return backToProfile(request, "tipo");
  }
  if (!(file instanceof File)) return backToProfile(request, "tipo");
  const result = await savePhoto(client, user.id, new Uint8Array(await file.arrayBuffer()));
  return backToProfile(request, statusOf[result.status]);
}
