"use server";
// Server actions da escolha da casa (#76). O navegador manda `{ houseId, joinMethod }`,
// `{ termVersion }` ou `{ answers }`; o servidor pontua as respostas e só as guarda no pedido de
// análise do resultado inconclusivo (ADR 0014). O cliente
// do Supabase é o da sessão, com o JWT de quem está logado (R14).
import { instance } from "@config/instance";
import { decryptField, encryptField, signQuestionnaireMessage } from "@/server/crypto";
import { requireUserBeforeHouse, requireUserClientBeforeHouse } from "@/server/auth/session";
import { log } from "@/server/log";
import type { HouseActionResult, SubmitAnswersResult } from "../types";
import { type AverageCache, compareHouse, type HouseAverage, type HouseComparison, type RateLimiter } from "./compare";
import { acceptHouse, type OnRefusal, recordConsent, type RefusalDetail, submitQuestionnaire } from "./houses";
import { getQuestionnaire } from "./questionnaire";
import { sessionHouseClient } from "./session";

/**
 * Registra a recusa. Só o código do motivo e, quando o banco recusou, o código do Postgres e o status do
 * PostgREST (#313): nada da pessoa, da casa, das respostas nem a mensagem do banco no log (R11).
 */
async function logged<R extends { ok: boolean }>(event: string, run: (onRefusal: OnRefusal) => Promise<R>): Promise<R> {
  let detail: RefusalDetail = {};
  const result = await run((d) => {
    detail = d;
  });
  if (!result.ok) {
    log.warn(event, {
      reason: "error" in result ? result.error : undefined,
      ...(detail.code ? { pg_code: detail.code } : {}),
      ...(detail.status ? { status: detail.status } : {}),
    });
  }
  return result;
}

export async function acceptHouseAction(input: unknown): Promise<HouseActionResult> {
  await requireUserBeforeHouse();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  const houseIds = instance.houses.map((h) => h.id);
  // A versão do termo vem do questionário carregado aqui, nunca do navegador.
  const termVersion = getQuestionnaire().consentTermVersion;
  return logged("house_accept_refused", (onRefusal) => acceptHouse(client, input, houseIds, termVersion, onRefusal));
}

export async function recordConsentAction(input: unknown): Promise<HouseActionResult> {
  await requireUserBeforeHouse();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  return logged("questionnaire_consent_refused", (onRefusal) => recordConsent(client, input, getQuestionnaire().consentTermVersion, onRefusal));
}

/**
 * Pontua as respostas no servidor e grava o resultado (ADR 0014 §1). O navegador manda só
 * `{ answers }`; a chave real do questionário nunca sai do servidor. Totem e respostas vão cifrados
 * ao banco (ADR 0003). As respostas não vão para o log.
 */
export async function submitAnswersAction(input: unknown): Promise<SubmitAnswersResult> {
  const { user } = await requireUserClientBeforeHouse();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  return logged("questionnaire_submit_refused", async (onRefusal): Promise<SubmitAnswersResult> => {
    try {
      return await submitQuestionnaire(client, input, {
        questionnaire: getQuestionnaire(),
        houseIds: instance.houses.map((h) => h.id),
        userId: user.id,
        nowSeconds: Math.floor(Date.now() / 1000),
        sign: signQuestionnaireMessage,
        encrypt: encryptField,
        onRefusal,
      });
    } catch {
      // Sem chave de assinatura (ou erro inesperado): falha fechado, sem detalhe nem respostas no log.
      return { ok: false, error: "failed" };
    }
  });
}

/** Médias por casa guardadas em memória do servidor (só o agregado: contas e somas, nunca notas por pessoa). */
const averageCache: AverageCache = new Map();
const averageInflight = new Map<string, Promise<HouseAverage>>();

/** No máximo 30 comparações por pessoa a cada 10 minutos (em memória do servidor). */
const compareWindowSeconds = 600;
const compareMaxPerWindow = 30;
const compareHits = new Map<string, number[]>();
const compareLimiter: RateLimiter = {
  allow(userId, nowSeconds) {
    const recent = (compareHits.get(userId) ?? []).filter((at) => nowSeconds - at < compareWindowSeconds);
    if (recent.length >= compareMaxPerWindow) {
      compareHits.set(userId, recent);
      return false;
    }
    recent.push(nowSeconds);
    compareHits.set(userId, recent);
    return true;
  },
};

/** Falha do banco na média fica guardada por alguns segundos; o token das respostas vale meia hora. */
const compareFailureSeconds = 10;
const compareTokenSeconds = 1800;

/**
 * Comparação de casa (#240): o que se espera na casa selecionada e, com membros suficientes, o perfil médio dela. As respostas
 * vêm do token que o servidor selou ao pontuar (nunca do navegador); a chave, as frases de expectativa e as notas dos membros
 * ficam no servidor; o navegador recebe só texto e o agregado arredondado, sem o número de membros.
 */
export async function compareHouseAction(input: unknown): Promise<HouseComparison> {
  const { user } = await requireUserClientBeforeHouse();
  const client = await sessionHouseClient();
  if (!client) return { ok: false, error: "failed" };
  try {
    return await compareHouse(client, input, {
      questionnaire: getQuestionnaire(),
      houseIds: instance.houses.map((h) => h.id),
      userId: user.id,
      nowSeconds: Math.floor(Date.now() / 1000),
      sign: signQuestionnaireMessage,
      decrypt: decryptField,
      minMembers: instance.houseSelection.minAverageMembers,
      cache: averageCache,
      cacheSeconds: instance.houseSelection.averageCacheSeconds,
      inflight: averageInflight,
      failureSeconds: compareFailureSeconds,
      tokenSeconds: compareTokenSeconds,
      limiter: compareLimiter,
      // Só a contagem de linhas que não decifraram: nunca valor, id nem mensagem.
      onSkipped: (count) => log.warn("house_compare_rows_skipped", { count }),
    });
  } catch {
    log.warn("house_compare_failed", {});
    return { ok: false, error: "failed" };
  }
}
