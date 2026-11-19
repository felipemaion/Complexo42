import "server-only";

export type FieldCryptoErrorCode =
  | "missing_key" // FIELD_ENCRYPTION_KEY ou BLIND_INDEX_KEY ausente no ambiente
  | "invalid_key" // chave com tamanho errado, repetida ou versão atual sem chave
  | "invalid_context" // tabela, coluna ou id da linha fora do formato
  | "invalid_input" // texto a cifrar ou a indexar fora do formato
  | "malformed" // valor cifrado não segue v<n>.<iv>.<ct>
  | "unknown_version" // nenhuma chave para a versão do valor
  | "decrypt_failed"; // chave errada, AAD errada ou valor adulterado

const MESSAGES: Record<FieldCryptoErrorCode, string> = {
  missing_key: "Chaves de criptografia ausentes (FIELD_ENCRYPTION_KEY e BLIND_INDEX_KEY).",
  invalid_key: "Chave de criptografia inválida.",
  invalid_context: "Contexto de criptografia inválido (tabela.coluna.id).",
  invalid_input: "Valor de entrada inválido para a criptografia.",
  malformed: "Valor cifrado malformado.",
  unknown_version: "Versão de chave desconhecida.",
  decrypt_failed: "Falha ao decifrar.",
};

/**
 * Erro do módulo de criptografia. A mensagem é fixa por código: nunca carrega texto claro,
 * valor cifrado nem chave (R11), então pode ir para o log como está.
 */
export class FieldCryptoError extends Error {
  readonly code: FieldCryptoErrorCode;

  constructor(code: FieldCryptoErrorCode) {
    super(MESSAGES[code]);
    this.name = "FieldCryptoError";
    this.code = code;
  }
}
