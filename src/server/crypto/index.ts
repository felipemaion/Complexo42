// Única porta para cifrar, decifrar e indexar dado pessoal (ADR 0003, AGENTS R13).
// `server-only`: o build do Next falha se um Client Component importar este módulo.
import "server-only";
import { decryptWith, emailBlindIndexWith, encryptWith, reencryptWith, whatsappBlindIndexWith, type FieldContext } from "./field";
import { getEnv } from "../env";
import { FieldCryptoError } from "./errors";
import { getKeyring } from "./keys";
import { sha256Hex as sha256HexOf, signMessage } from "./result-signature";

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

/** `whatsapp_hmac`: HMAC-SHA256 em hex de "wa:" + WhatsApp em E.164. */
export async function whatsappBlindIndex(whatsappE164: string): Promise<string> {
  return whatsappBlindIndexWith(await getKeyring(), whatsappE164);
}

/** `access_allowlist.email_hmac`: HMAC-SHA256 em hex de "em:" + e-mail em minúsculas e sem espaços. */
export async function emailBlindIndex(email: string): Promise<string> {
  return emailBlindIndexWith(await getKeyring(), email);
}

/** Assina o resultado do questionário para o banco conferir (ADR 0014 §1). Falha fechado sem a chave. */
export function signQuestionnaireMessage(message: string): string {
  const key = getEnv().QUESTIONNAIRE_SIGNING_KEY;
  if (!key) throw new FieldCryptoError("missing_key");
  return signMessage(key, message);
}


/** SHA-256 (hex) de um valor (o hash das respostas cifradas que a resolução do pedido assina). */
export const sha256Hex = sha256HexOf;
