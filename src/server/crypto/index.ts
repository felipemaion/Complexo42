// Única porta para cifrar, decifrar e indexar dado pessoal (ADR 0003, AGENTS R13).
// `server-only`: o build do Next falha se um Client Component importar este módulo.
import "server-only";
import { decryptWith, emailBlindIndexWith, encryptWith, reencryptWith, whatsappBlindIndexWith, type FieldContext } from "./field";
import { getKeyring } from "./keys";

export { FieldCryptoError, type FieldCryptoErrorCode } from "./errors";
export { keyVersionOf, normalizeE164, normalizeEmail, type FieldContext } from "./field";

/** Cifra com a chave atual. Ex.: `encryptField(nome, { table: "profiles", column: "display_name_enc", rowId })`. */
export async function encryptField(plaintext: string, context: FieldContext): Promise<string> {
  return encryptWith(await getKeyring(), plaintext, context);
}

/** Decifra com a chave da versão do valor. Falha se a chave, o contexto ou o valor não baterem. */
export async function decryptField(value: string, context: FieldContext): Promise<string> {
  return decryptWith(await getKeyring(), value, context);
}

/** Para o script de rotação: devolve o valor recifrado com a chave atual (ou o mesmo, se já estiver). */
export async function reencryptField(value: string, context: FieldContext): Promise<string> {
  return reencryptWith(await getKeyring(), value, context);
}

/** `whatsapp_hmac`: HMAC-SHA256 em hex do WhatsApp em E.164. */
export async function whatsappBlindIndex(whatsappE164: string): Promise<string> {
  return whatsappBlindIndexWith(await getKeyring(), whatsappE164);
}

/** `access_allowlist.email_hmac`: HMAC-SHA256 em hex do e-mail em minúsculas e sem espaços. */
export async function emailBlindIndex(email: string): Promise<string> {
  return emailBlindIndexWith(await getKeyring(), email);
}
