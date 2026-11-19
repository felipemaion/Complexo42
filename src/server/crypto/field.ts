import "server-only";
import { FieldCryptoError } from "./errors";
import type { Keyring } from "./keys";

// Formato (ADR 0003 §3): v<versão>.<iv base64url, 12 bytes>.<ciphertext+tag base64url>
// AES-256-GCM com tag de 128 bits e AAD = "<tabela>.<coluna>.<id da linha>".

/** Onde o valor mora. Entra como AAD: o valor cifrado não pode ser copiado para outra linha. */
export type FieldContext = { table: string; column: string; rowId: string };

const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/; // nome de tabela/coluna do Postgres, sem ponto
const ROW_ID = /^[A-Za-z0-9_-]{1,128}$/; // uuid ou inteiro; sem ponto, para o AAD não ser ambíguo
const VALUE = /^v([1-9]\d{0,2})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const E164 = /^\+[1-9]\d{7,14}$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function additionalData({ table, column, rowId }: FieldContext): Uint8Array<ArrayBuffer> {
  if (!IDENTIFIER.test(table) || !IDENTIFIER.test(column) || !ROW_ID.test(rowId)) throw new FieldCryptoError("invalid_context");
  return encoder.encode(`${table}.${column}.${rowId}`);
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** base64url estrito: sem padding e com a volta idêntica (o Buffer aceita lixo em silêncio). */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  const bytes = new Uint8Array(Buffer.from(text, "base64url"));
  return toBase64Url(bytes) === text ? bytes : null;
}

type Parsed = { version: number; iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> };

function parse(value: string): Parsed {
  const match = typeof value === "string" ? VALUE.exec(value) : null;
  const iv = match ? fromBase64Url(match[2] as string) : null;
  const ciphertext = match ? fromBase64Url(match[3] as string) : null;
  if (!match || !iv || !ciphertext || iv.length !== IV_BYTES || ciphertext.length < TAG_BYTES) throw new FieldCryptoError("malformed");
  return { version: Number(match[1]), iv, ciphertext };
}

/** Versão da chave que cifrou o valor. Lança `malformed` se o valor não estiver no formato. */
export function keyVersionOf(value: string): number {
  return parse(value).version;
}

export async function encryptWith(keyring: Keyring, plaintext: string, context: FieldContext): Promise<string> {
  const aad = additionalData(context);
  if (typeof plaintext !== "string") throw new FieldCryptoError("invalid_input");
  const data = encoder.encode(plaintext);
  if (data.length > MAX_PLAINTEXT_BYTES) throw new FieldCryptoError("invalid_input");
  const key = keyring.fieldKeys.get(keyring.currentVersion);
  if (!key) throw new FieldCryptoError("invalid_key");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, data);
  return `v${keyring.currentVersion}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptWith(keyring: Keyring, value: string, context: FieldContext): Promise<string> {
  const aad = additionalData(context);
  const { version, iv, ciphertext } = parse(value);
  const key = keyring.fieldKeys.get(version);
  if (!key) throw new FieldCryptoError("unknown_version");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ciphertext);
    return decoder.decode(plain);
  } catch {
    // Chave errada, AAD errada e adulteração são indistinguíveis no GCM, e assim deve ser.
    throw new FieldCryptoError("decrypt_failed");
  }
}

/** Rotação: recifra com a chave atual se o valor ainda estiver numa versão antiga. */
export async function reencryptWith(keyring: Keyring, value: string, context: FieldContext): Promise<string> {
  if (keyVersionOf(value) === keyring.currentVersion) {
    await decryptWith(keyring, value, context); // não devolve como "ok" um valor que não decifra
    return value;
  }
  return encryptWith(keyring, await decryptWith(keyring, value, context), context);
}

/** E-mail como o ADR 0008 §1 pede: sem espaços nas pontas e em minúsculas. */
export function normalizeEmail(email: string): string {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(normalized)) throw new FieldCryptoError("invalid_input");
  return normalized;
}

/** WhatsApp já em E.164 (+5511999998888). Converter o que a pessoa digitou é papel do formulário. */
export function normalizeE164(whatsapp: string): string {
  const normalized = typeof whatsapp === "string" ? whatsapp.trim() : "";
  if (!E164.test(normalized)) throw new FieldCryptoError("invalid_input");
  return normalized;
}

async function hmacHex(keyring: Keyring, normalized: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", keyring.blindIndexKey, encoder.encode(normalized));
  return Buffer.from(mac).toString("hex");
}

/** HMAC-SHA256(BLIND_INDEX_KEY, whatsapp E.164) em hex: unicidade e busca exata (ADR 0003 §3). */
export async function whatsappBlindIndexWith(keyring: Keyring, whatsappE164: string): Promise<string> {
  return hmacHex(keyring, normalizeE164(whatsappE164));
}

/** HMAC-SHA256(BLIND_INDEX_KEY, e-mail normalizado) em hex: lista de autorizados (ADR 0008 §1). */
export async function emailBlindIndexWith(keyring: Keyring, email: string): Promise<string> {
  return hmacHex(keyring, normalizeEmail(email));
}
