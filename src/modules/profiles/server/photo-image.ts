// Conversão da foto (#308): o que entra é JPEG/PNG/WebP de até 2 MB; o que sai é uma miniatura WebP
// 192x256 SEM metadados (EXIF, GPS, XMP, ICC). O original vive só em memória e é descartado. Nada
// aqui loga nem guarda a imagem (R11).
import "server-only";
import { detectPhotoType, photoLimits } from "../domain/photo";

// O sharp carrega o binário da plataforma ao ser importado, então entra SÓ aqui, sob demanda: as rotas que
// nunca convertem (leitura da foto, páginas) não dependem dele. O rastreio do `standalone` o inclui só para
// a rota de envio (next.config.ts).
async function loadSharp() {
  const { default: sharp } = await import("sharp");
  // Sem cache de arquivos do libvips: o servidor é pequeno e cada envio é uma imagem só.
  sharp.cache(false);
  return sharp;
}

export type ThumbnailResult = { ok: true; webp: Buffer } | { ok: false; reason: "type" | "unreadable" };

/** Qualidade da mais alta para a mais baixa: para na primeira miniatura que cabe no teto. */
const qualities = [80, 65, 50, 35] as const;

export async function makePhotoThumbnail(input: Uint8Array): Promise<ThumbnailResult> {
  if (detectPhotoType(input) === null) return { ok: false, reason: "type" };
  try {
    const sharp = await loadSharp();
    for (const quality of qualities) {
      // `rotate()` sem argumento aplica a orientação do EXIF e a descarta; sem `withMetadata`, o sharp NÃO
      // copia EXIF, GPS, XMP nem ICC para a saída. `limitInputPixels` recusa a bomba de descompressão
      // antes de decodificar.
      const webp = await sharp(input, { limitInputPixels: photoLimits.maxInputPixels, failOn: "error", pages: 1, animated: false })
        .rotate()
        .resize(photoLimits.width, photoLimits.height, { fit: "cover" })
        .toColourspace("srgb")
        .webp({ quality })
        .toBuffer();
      if (webp.length <= photoLimits.maxOutputBytes) return { ok: true, webp };
    }
    return { ok: false, reason: "unreadable" };
  } catch {
    // Imagem quebrada ou grande demais: o motivo técnico não sobe (pode citar o arquivo).
    return { ok: false, reason: "unreadable" };
  }
}
