import "server-only";
import { createHmac } from "node:crypto";

/**
 * Assinatura HMAC-SHA256 (hex) do resultado do questionário (ADR 0014 §1). O banco confere com a
 * mesma chave (`app.verify_server_signature`): só o servidor do app consegue produzir um resultado
 * que o banco aceita. A chave é o texto de QUESTIONNAIRE_SIGNING_KEY, como está no banco. A mensagem
 * cobre o valor CIFRADO do totem ou das respostas (ADR 0014): o navegador não troca o conteúdo.
 */
export function signMessage(signingKey: string, message: string): string {
  return createHmac("sha256", signingKey).update(message, "utf8").digest("hex");
}
