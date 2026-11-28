// Foto do perfil no servidor (#308, ADR 0003 e ADR 0006 revisão de 2026-11-28). A imagem só existe em
// memória: é convertida em miniatura WebP (sem metadados), cifrada em base64 com o AAD da linha e
// gravada por `save_own_photo`, com o JWT da pessoa (R14). A leitura volta pelo mesmo caminho, com a
// RLS (`app.can_view_photo`) decidindo quem vê. Nada da imagem vai para log (R11).
import "server-only";
import { z } from "zod";
import { decryptField, encryptField } from "@/server/crypto";
import { log as appLog, type Logger } from "@/server/log";
import { detectPhotoType, photoLimits } from "../domain/photo";
import type { ProfileDbClient } from "../types";
import { makePhotoThumbnail } from "./photo-image";

export type PhotoDeps = {
  encrypt: typeof encryptField;
  decrypt: typeof decryptField;
  log: Logger;
};

const defaultDeps: PhotoDeps = { encrypt: encryptField, decrypt: decryptField, log: appLog };

const uuid = z.guid();
const photoRow = z.object({ photo_enc: z.string() });

/** Só o código do erro (Postgres/PostgREST), nunca a mensagem. */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.slice(0, 16) : "unknown";
}

export type SavePhotoResult = {
  status: "saved" | "invalid_type" | "too_large" | "unreadable" | "too_many_attempts" | "forbidden" | "failed";
};

/**
 * Converte, cifra e grava a foto de `userId` (quem está logado; o banco confere de novo com
 * `auth.uid()`). O limite de 10 envios por hora é do banco e se paga ANTES de converter (`PT429` vira
 * `too_many_attempts`).
 */
export async function savePhoto(
  client: ProfileDbClient,
  userId: string,
  bytes: Uint8Array,
  deps: PhotoDeps = defaultDeps,
): Promise<SavePhotoResult> {
  const rowId = uuid.parse(userId);
  if (bytes.length > photoLimits.maxUploadBytes) return { status: "too_large" };
  // Barato e sem CPU: o tipo vem dos primeiros bytes. O que não é JPEG/PNG/WebP nem consome cota.
  if (detectPhotoType(bytes) === null) return { status: "invalid_type" };

  // A cota é reservada ANTES do sharp: imagem pesada ou quebrada gasta CPU na conversão, então tem de
  // consumir a cota mesmo sem chegar a gravar (`reserve_photo_upload`: 10 por hora, PT429).
  const reserved = await client.rpc("reserve_photo_upload");
  if (reserved.error) return photoRpcFailure(reserved.error, deps);

  const thumbnail = await makePhotoThumbnail(bytes);
  if (!thumbnail.ok) return { status: "unreadable" };

  let photoEnc: string;
  try {
    photoEnc = await deps.encrypt(thumbnail.webp.toString("base64"), { table: "profile_photos", column: "photo_enc", rowId });
  } catch (error) {
    deps.log.error("photo_encrypt_failed", { reason: errorCode(error) });
    return { status: "failed" };
  }

  const { error } = await client.rpc("save_own_photo", { p_photo_enc: photoEnc });
  if (!error) return { status: "saved" };
  return photoRpcFailure(error, deps);
}

/** Erro do banco (reserva ou gravação) vira o resultado da tela; só o código vai ao log (R11). */
function photoRpcFailure(error: unknown, deps: PhotoDeps): SavePhotoResult {
  const code = errorCode(error);
  if (code === "PT429") {
    deps.log.warn("photo_save_rate_limited", { reason: code });
    return { status: "too_many_attempts" };
  }
  if (code === "42501") {
    deps.log.warn("photo_save_denied", { reason: code });
    return { status: "forbidden" };
  }
  deps.log.error("photo_save_failed", { reason: code });
  return { status: "failed" };
}

/**
 * A miniatura de `profileId` (WebP), lida e decifrada com o cliente de quem pede: a RLS esconde a de
 * quem essa pessoa não pode ver, e o resultado é o mesmo de "sem foto" (`null`), para não revelar quem
 * tem foto. Erro de leitura SOBE (falha fechada); valor que não decifra vira `null` com log da coluna.
 */
export async function loadPhoto(
  client: ProfileDbClient,
  profileId: string,
  deps: PhotoDeps = defaultDeps,
): Promise<Buffer | null> {
  const parsedId = uuid.safeParse(profileId);
  if (!parsedId.success) return null;
  const rowId = parsedId.data;
  const { data, error } = await client.from("profile_photos").select("photo_enc").eq("profile_id", rowId).maybeSingle();
  if (error) throw new Error(`photo_read_failed:${errorCode(error)}`);
  const row = photoRow.safeParse(data);
  if (!row.success) return null;
  let webp: Buffer;
  try {
    webp = Buffer.from(await deps.decrypt(row.data.photo_enc, { table: "profile_photos", column: "photo_enc", rowId }), "base64");
  } catch (err) {
    deps.log.warn("photo_decrypt_failed", { column: "photo_enc", reason: errorCode(err) });
    return null;
  }
  if (detectPhotoType(webp) !== "webp") {
    deps.log.warn("photo_decrypt_failed", { column: "photo_enc", reason: "invalid_image" });
    return null;
  }
  return webp;
}

/** A própria pessoa tem foto? Só o dono chama (a RLS de quem não é dono devolveria o mesmo para outros). */
export async function hasOwnPhoto(client: ProfileDbClient, userId: string): Promise<boolean> {
  const rowId = uuid.parse(userId);
  const { data, error } = await client.from("profile_photos").select("profile_id").eq("profile_id", rowId).maybeSingle();
  if (error) throw new Error(`photo_read_failed:${errorCode(error)}`);
  return data !== null;
}

/** Remove a foto da própria pessoa (a RLS só deixa apagar a sua). */
export async function removeOwnPhoto(client: ProfileDbClient, userId: string, deps: PhotoDeps = defaultDeps): Promise<boolean> {
  const rowId = uuid.parse(userId);
  const { error } = await client.from("profile_photos").delete().eq("profile_id", rowId);
  if (error) {
    deps.log.error("photo_remove_failed", { reason: errorCode(error) });
    return false;
  }
  return true;
}

/**
 * Lê o corpo da requisição só até `maxBytes`: passou disso, cancela o fluxo (não lê o resto) e devolve
 * `null`. É o limite ANTES de ler tudo, que o `Content-Length` sozinho não garante (pode faltar ou mentir).
 */
export async function readBodyCapped(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (stream === null) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
