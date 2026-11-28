// Foto do perfil (#308, ADR 0006 revisão de 2026-11-28). Regras puras: o que o envio aceita, o
// tamanho da miniatura e o vocabulário do aviso que volta à tela. Quem converte a imagem é
// `../server/photo-image.ts`; quem grava e lê é `../server/photo.ts`.

export const photoLimits = {
  /** Arquivo enviado: até 2 MB (o servidor recusa antes de ler o resto). */
  maxUploadBytes: 2 * 1024 * 1024,
  /** Folga do envelope multipart (nome do arquivo, limites, outros campos) sobre o arquivo. */
  bodyOverheadBytes: 64 * 1024,
  /** Miniatura 3x4 de ~256 px na maior borda. */
  width: 192,
  height: 256,
  /** Teto de pixels da imagem DECODIFICADA (bomba de descompressão): 24 megapixels cobre qualquer celular. */
  maxInputPixels: 24_000_000,
  /** Teto da miniatura WebP: normalmente ~20 KB; em base64 cabe nos 65 536 caracteres do banco. */
  maxOutputBytes: 40 * 1024,
  /** Envios por pessoa e por hora (`save_own_photo`, `PT429`). */
  uploadsPerHour: 10,
} as const;

/** Só estas três; o tipo vem dos primeiros bytes, nunca do nome nem do `Content-Type` declarado. */
export type PhotoInputType = "jpeg" | "png" | "webp";

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  bytes.length >= start + text.length && [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0));

export function detectPhotoType(bytes: Uint8Array): PhotoInputType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "png";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "webp";
  return null;
}

export const PHOTO_UPLOAD_PATH = "/perfil/foto";
export const PHOTO_REMOVE_PATH = "/perfil/foto/remover";
export const PHOTO_STATUS_PARAM = "foto";
export const photoStatuses = ["ok", "removida", "tipo", "grande", "ilegivel", "limite", "erro"] as const;
export type PhotoStatus = (typeof photoStatuses)[number];

/** Lê o parâmetro do perfil; qualquer outro valor é ignorado. */
export function parsePhotoStatus(raw: unknown): PhotoStatus | null {
  return (photoStatuses as readonly unknown[]).includes(raw) ? (raw as PhotoStatus) : null;
}

/** Endereço da miniatura de uma pessoa (rota do servidor, só para membros logados). */
export const photoUrl = (profileId: string) => `/foto/${profileId}`;
