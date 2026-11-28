// Token das respostas da comparação de casas (#240): as respostas não são guardadas (ADR 0014); o servidor as sela, ao pontuar o
// questionário, num valor cifrado para a pessoa (AAD com o id dela) que o navegador só carrega. A comparação o abre no servidor.
import "server-only";
import { z } from "zod";
import { answerValues, type Answers } from "@/modules/questionnaire";
import type { CipherContext } from "../types";

const tokenContext = (userId: string): CipherContext => ({ table: "compare_tokens", column: "answers", rowId: userId });
const houseScores = z.strictObject({ house1: z.number().min(-100).max(100), house2: z.number().min(-100).max(100) });
const tokenBody = z.union([
  z.strictObject({ a: z.record(z.string(), z.literal([...answerValues])), t: z.number().int() }),
  z.strictObject({ s: houseScores, t: z.number().int() }),
]);

/** Sobre o que a comparação se apoia: as respostas (expectativa por pergunta) ou, sem elas, as notas dos eixos da casa. */
export type CompareBasis = { kind: "answers"; answers: Answers } | { kind: "scores"; scores: { house1: number; house2: number } };
/** Token legítimo (desta pessoa, íntegro) mas vencido: a tela pede para recarregar. */
export type ExpiredBasis = { kind: "expired" };

type Encrypt = (plaintext: string, context: CipherContext) => Promise<string>;
type Decrypt = (value: string, context: CipherContext) => Promise<string>;

/** Sela as respostas (só dentro do servidor, ao pontuar) num valor cifrado para a pessoa: o navegador o guarda sem ler nem trocar. */
export async function sealCompareToken(answers: Answers, userId: string, nowSeconds: number, encrypt: Encrypt): Promise<string> {
  return encrypt(JSON.stringify({ a: answers, t: nowSeconds }), tokenContext(userId));
}

/** Sela só as notas dos eixos da casa (quem não tem respostas guardadas): o totem nunca entra no token. */
export async function sealScoresToken(scores: { house1: number; house2: number } & Record<string, unknown>, userId: string, nowSeconds: number, encrypt: Encrypt): Promise<string> {
  return encrypt(JSON.stringify({ s: { house1: scores.house1, house2: scores.house2 }, t: nowSeconds }), tokenContext(userId));
}

/** Abre o token: a base da comparação, ou null se não é desta pessoa, foi adulterado, tem formato errado ou venceu. */
export async function openCompareBasis(token: string, userId: string, nowSeconds: number, tokenSeconds: number, decrypt: Decrypt): Promise<CompareBasis | ExpiredBasis | null> {
  try {
    const body = tokenBody.parse(JSON.parse(await decrypt(token, tokenContext(userId))));
    if (nowSeconds - body.t < -30) return null;
    if (nowSeconds - body.t > tokenSeconds) return { kind: "expired" };
    return "a" in body ? { kind: "answers", answers: body.a } : { kind: "scores", scores: body.s };
  } catch {
    return null;
  }
}

/** Só as respostas (token de respostas); o de notas não vira respostas. */
export async function openCompareToken(token: string, userId: string, nowSeconds: number, tokenSeconds: number, decrypt: Decrypt): Promise<Answers | null> {
  const basis = await openCompareBasis(token, userId, nowSeconds, tokenSeconds, decrypt);
  return basis?.kind === "answers" ? basis.answers : null;
}
