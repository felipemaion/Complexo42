// Coordenação do questionário no servidor (ADR 0014): ler o totem e os pedidos de análise (o
// banco só guarda o valor CIFRADO, ADR 0003; aqui ele é decifrado para quem a RLS deixou ler),
// resolver a fila e delegar o acesso. Ainda SEM chamador: a tela da fila é a issue #174 (estas funções
// existem, testadas, para ela usar). Usa o cliente com o JWT de quem está logado (R14): o banco
// decide quem lê (a própria pessoa, a coordenação nacional ou quem ela delegou) e quem resolve
// ou concede (só a coordenação nacional). Nada aqui vai para log (R11).
import "server-only";
import { z } from "zod";
import type { CipherContext, HouseClient } from "../types";
import { answersContext, totemContext } from "./houses";

export type CoordinationCrypto = {
  decrypt(value: string, context: CipherContext): Promise<string>;
  encrypt(plaintext: string, context: CipherContext): Promise<string>;
};

export type CoordinationError = "forbidden" | "invalid" | "not_found" | "exists" | "failed";
const errorByCode: Record<string, CoordinationError> = {
  "42501": "forbidden",
  "22023": "invalid",
  P0002: "not_found",
  "23505": "exists",
};
function errorOf(error: unknown): CoordinationError {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return (typeof code === "string" && errorByCode[code]) || "failed";
}

const resultRow = z.object({ house_key: z.string(), totem_enc: z.string(), source: z.string(), created_at: z.string() });

export type QuestionnaireResultView = { houseId: string; totem: string; source: string; createdAt: string };

/** Casa e totem de `personId`, ou null se não há resultado ou a RLS não deixa ler. Decifra o totem. */
export async function readQuestionnaireResultOf(
  client: HouseClient,
  personId: string,
  crypto: CoordinationCrypto,
): Promise<QuestionnaireResultView | null> {
  const { data, error } = await client
    .from("questionnaire_results")
    .select("house_key,totem_enc,source,created_at")
    .eq("profile_id", personId)
    .maybeSingle();
  if (error) throw new Error(`questionnaire_read_failed:${errorOf(error)}`);
  const row = z.nullable(resultRow).parse(data);
  if (!row) return null;
  let totem: string;
  try {
    totem = await crypto.decrypt(row.totem_enc, totemContext(personId));
  } catch {
    // Só o nome da coluna: nunca a mensagem do erro nem o valor.
    throw new Error("decrypt_failed:totem_enc");
  }
  return { houseId: row.house_key, totem, source: row.source, createdAt: row.created_at };
}

const requestRow = z.object({
  id: z.string(),
  profile_id: z.string(),
  tied_axes: z.array(z.string()),
  answers_enc: z.string(),
  created_at: z.string(),
});
const answersJson = z.record(z.string(), z.string());

export type AnalysisRequestView = {
  requestId: string;
  profileId: string;
  tiedAxes: string[];
  answers: Record<string, string>;
  createdAt: string;
};

export type AnalysisRequestList = {
  requests: AnalysisRequestView[];
  /** Quantas linhas não deram para ler (valor que não decifra, formato inesperado): a fila segue sem elas. */
  unreadable: number;
};

/**
 * Pedidos abertos que a RLS deixa ver a quem chama (nacional: todos; delegado: os do escopo), com as
 * respostas decifradas. Linha a linha: uma linha ilegível NÃO derruba a fila; ela é contada em
 * `unreadable` e `onUnreadable` recebe só o NOME da coluna (como o export), nunca valor nem a
 * mensagem do erro (que poderia trazer trecho de texto claro).
 */
export async function listOpenAnalysisRequests(
  client: HouseClient,
  crypto: CoordinationCrypto,
  onUnreadable?: (column: string) => void,
): Promise<AnalysisRequestList> {
  const { data, error } = await client
    .from("house_analysis_requests")
    .select("id,profile_id,tied_axes,answers_enc,created_at")
    .eq("status", "open");
  if (error) throw new Error(`analysis_read_failed:${errorOf(error)}`);
  const rawRows: unknown[] = Array.isArray(data) ? data : [];
  const settled = await Promise.allSettled(
    rawRows.map(async (raw): Promise<AnalysisRequestView> => {
      const row = requestRow.safeParse(raw);
      if (!row.success) throw new UnreadableRow("row");
      let plain: string;
      try {
        plain = await crypto.decrypt(row.data.answers_enc, answersContext(row.data.profile_id));
      } catch {
        throw new UnreadableRow("answers_enc");
      }
      let answers: Record<string, string>;
      try {
        answers = answersJson.parse(JSON.parse(plain));
      } catch {
        throw new UnreadableRow("answers_enc");
      }
      return { requestId: row.data.id, profileId: row.data.profile_id, tiedAxes: row.data.tied_axes, answers, createdAt: row.data.created_at };
    }),
  );
  const requests: AnalysisRequestView[] = [];
  let unreadable = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") requests.push(outcome.value);
    else {
      unreadable += 1;
      onUnreadable?.(outcome.reason instanceof UnreadableRow ? outcome.reason.column : "row");
    }
  }
  return { requests, unreadable };
}

/** Erro interno que carrega só o nome da coluna (sem valor nem mensagem de origem). */
class UnreadableRow extends Error {
  constructor(readonly column: string) {
    super(`unreadable:${column}`);
  }
}

/** Quem assina a resolução: o servidor, para a pessoa da sessão (nunca vinda do navegador). */
export type ResolveSigning = { userId: string; nowSeconds: number; sign(message: string): string };

export type CoordinationResult = { ok: true } | { ok: false; error: CoordinationError };

/**
 * Resolve o pedido: a coordenação nacional escolhe a casa (da config) e o totem; o servidor cifra
 * o totem para a pessoa do pedido. Só a nacional resolve: a delegação não inclui resolver (o banco recusa).
 */
export async function resolveAnalysis(
  client: HouseClient,
  input: unknown,
  houseIds: readonly string[],
  crypto: CoordinationCrypto,
  signing: ResolveSigning,
): Promise<CoordinationResult> {
  const parsed = z
    .strictObject({
      requestId: z.uuid(),
      houseId: z.string().refine((id) => houseIds.includes(id)),
      totem: z.string().regex(/^[A-Z]{2}$/),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const found = await client.from("house_analysis_requests").select("profile_id").eq("id", parsed.data.requestId).eq("status", "open").maybeSingle();
  if (found.error) return { ok: false, error: errorOf(found.error) };
  const person = z.nullable(z.object({ profile_id: z.string() })).parse(found.data);
  if (!person) return { ok: false, error: "not_found" };
  const totemEnc = await crypto.encrypt(parsed.data.totem, totemContext(person.profile_id));
  // O banco só aceita a resolução assinada pelo servidor (pedido, casa e totem cifrado, para quem resolve).
  const { userId, nowSeconds, sign } = signing;
  const signature = sign(`resolve|${userId}|${parsed.data.requestId}|${parsed.data.houseId}|${totemEnc}|${nowSeconds}`);
  const { error } = await client.rpc("resolve_house_analysis", {
    p_request_id: parsed.data.requestId,
    p_house_key: parsed.data.houseId,
    p_totem_enc: totemEnc,
    p_issued_at: nowSeconds,
    p_signature: signature,
  });
  return error ? { ok: false, error: errorOf(error) } : { ok: true };
}

/** A coordenação nacional concede a um gestor de unidade abaixo da raiz o acesso ao totem e aos pedidos do escopo dele. */
export async function grantQuestionnaireAccess(
  client: HouseClient,
  input: unknown,
): Promise<{ ok: true; grantId: string } | { ok: false; error: CoordinationError }> {
  const parsed = z.strictObject({ granteeId: z.uuid(), unitId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { data, error } = await client.rpc("grant_questionnaire_access", { p_grantee: parsed.data.granteeId, p_unit_id: parsed.data.unitId });
  if (error) return { ok: false, error: errorOf(error) };
  const id = z.string().safeParse(data);
  return id.success ? { ok: true, grantId: id.data } : { ok: false, error: "failed" };
}

/** A coordenação nacional revoga a concessão; a pessoa delegada deixa de ler na hora. */
export async function revokeQuestionnaireAccess(client: HouseClient, input: unknown): Promise<CoordinationResult> {
  const parsed = z.strictObject({ grantId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("revoke_questionnaire_access", { p_grant_id: parsed.data.grantId });
  return error ? { ok: false, error: errorOf(error) } : { ok: true };
}
