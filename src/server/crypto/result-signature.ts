import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * Assinatura HMAC-SHA256 (hex) do resultado do questionário (ADR 0014 §1). O banco confere com a
 * mesma chave (`app.verify_server_signature`): só o servidor do app consegue produzir um resultado
 * que o banco aceita. A chave é o texto de QUESTIONNAIRE_SIGNING_KEY, como está no banco.
 */
export function signMessage(signingKey: string, message: string): string {
  return createHmac("sha256", signingKey).update(message, "utf8").digest("hex");
}

/**
 * Resumo SHA-256 (hex) das respostas, na forma canônica que o banco recalcula: `id=valor`
 * ordenado pelo id (só `[a-z0-9-]`, então a ordem de código coincide com a do banco) e separado
 * por vírgula. A assinatura do pedido de análise cobre este resumo (ADR 0014 §1).
 */
export function answersDigest(answers: Readonly<Record<string, string>>): string {
  const canonical = Object.keys(answers)
    .sort()
    .map((id) => `${id}=${answers[id]}`)
    .join(",");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
