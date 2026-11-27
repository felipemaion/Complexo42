// Token das respostas da comparação de casas (#240): as respostas não são guardadas (ADR 0014); o servidor as sela, ao pontuar o
// questionário, num valor cifrado para a pessoa (AAD com o id dela) que o navegador só carrega. A comparação o abre no servidor.
import "server-only";
import { z } from "zod";
import { answerValues, type Answers } from "@/modules/questionnaire";
import type { CipherContext } from "../types";

const tokenContext = (userId: string): CipherContext => ({ table: "compare_tokens", column: "answers", rowId: userId });
const tokenBody = z.object({ a: z.record(z.string(), z.literal([...answerValues])), t: z.number().int() });

/** Sela as respostas (só dentro do servidor, ao pontuar) num valor cifrado para a pessoa: o navegador o guarda sem ler nem trocar. */
export async function sealCompareToken(
  answers: Answers,
  userId: string,
  nowSeconds: number,
  encrypt: (plaintext: string, context: CipherContext) => Promise<string>,
): Promise<string> {
  return encrypt(JSON.stringify({ a: answers, t: nowSeconds }), tokenContext(userId));
}

/** Abre o token: as respostas, ou null se não é desta pessoa, foi adulterado, tem formato errado ou venceu. */
export async function openCompareToken(
  token: string,
  userId: string,
  nowSeconds: number,
  tokenSeconds: number,
  decrypt: (value: string, context: CipherContext) => Promise<string>,
): Promise<Answers | null> {
  try {
    const body = tokenBody.parse(JSON.parse(await decrypt(token, tokenContext(userId))));
    return nowSeconds - body.t <= tokenSeconds && nowSeconds - body.t >= -30 ? body.a : null;
  } catch {
    return null;
  }
}

