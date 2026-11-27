// Dados das telas da coordenação do questionário (#174, ADR 0014): resultados, fila de análise e
// delegações. Só o cliente da sessão (JWT de quem está logado, R14): quem pode ler é decidido pela
// RLS e quem pode abrir/resolver/delegar, pelas funções do banco; aqui só se monta o que a tela
// mostra. Abrir o resultado ou o caso de alguém registra o acesso (`log_questionnaire_view`: ator e
// alvo, sem conteúdo). Nada daqui vai para log (R11): linhas ilegíveis são só contadas.
import "server-only";
import { z } from "zod";
import {
  axisKeys,
  chartAxes,
  scoreQuestionnaire,
  type AxisScores,
  type ChartAxis,
  type QuestionnaireConfig,
} from "@/modules/questionnaire";
import { instance } from "@config/instance";
import type { HouseClient } from "../types";
import { listOpenAnalysisRequests, readQuestionnaireResultOf, type CoordinationCrypto, type QuestionnaireResultView } from "./coordination";

export type ViewDeps = { crypto: CoordinationCrypto; questionnaire: QuestionnaireConfig };

// ---------------------------------------------------------------------------------------
// Quem pode usar as telas (só para o menu e o 404: o banco decide de verdade)
// ---------------------------------------------------------------------------------------
export type CoordinationAccess = { national: boolean; delegate: boolean };

const accessShape = z.strictObject({ national: z.boolean(), delegate: z.boolean() });
const noAccess: CoordinationAccess = { national: false, delegate: false };

/** O que quem chama pode fazer. Erro ou resposta inesperada: nada (falha fechado). */
export async function readCoordinationAccess(client: HouseClient): Promise<CoordinationAccess> {
  const { data, error } = await client.rpc("questionnaire_coordination_access", {});
  if (error) return noAccess;
  const parsed = accessShape.safeParse(data);
  return parsed.success ? parsed.data : noAccess;
}

/** Ver resultados e fila: a coordenação nacional ou quem ela delegou. */
export function canSeeResults(access: CoordinationAccess): boolean {
  return access.national || access.delegate;
}

// ---------------------------------------------------------------------------------------
// Nomes (os de `profiles` são cifrados: o servidor decifra com o AAD da linha)
// ---------------------------------------------------------------------------------------
const nameRows = z.array(z.object({ id: z.string(), display_name_enc: z.string() }));

async function readNames(client: HouseClient, ids: readonly string[], crypto: CoordinationCrypto): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  const { data, error } = await client.from("profiles").select("id,display_name_enc").in("id", [...new Set(ids)]);
  if (error) return names;
  const rows = nameRows.safeParse(data);
  if (!rows.success) return names;
  await Promise.all(
    rows.data.map(async (row) => {
      try {
        names.set(row.id, await crypto.decrypt(row.display_name_enc, { table: "profiles", column: "display_name_enc", rowId: row.id }));
      } catch {
        names.set(row.id, null);
      }
    }),
  );
  return names;
}

const uuid = z.uuid();
const dbErrorCode = (error: unknown): string => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9]{1,8}$/.test(code) && code !== "XX" ? code : "failed";
};

// ---------------------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------------------
const resultListRow = z.object({ profile_id: z.string(), house_key: z.string(), totem_enc: z.string(), created_at: z.string() });

export type ResultRow = { profileId: string; name: string | null; houseId: string; totem: string; createdAt: string };

/** Máximo de linhas por tela, até a paginação (decifrar é por linha). */
const maxRows = 500;

/**
 * Pessoas com resultado que a RLS deixa ver a quem chama (nacional: todas as ativas; delegado: as do
 * escopo), do mais novo ao mais antigo, com o totem decifrado. `houseId` filtra pela casa (só casas
 * da config). Linha ilegível sai da lista e é contada em `unreadable`.
 */
export async function listResults(
  client: HouseClient,
  deps: ViewDeps,
  filter: { houseId?: string },
): Promise<{ rows: ResultRow[]; unreadable: number }> {
  let query = client.from("questionnaire_results").select("profile_id,house_key,totem_enc,created_at");
  if (filter.houseId !== undefined && instance.houses.some((house) => house.id === filter.houseId)) query = query.eq("house_key", filter.houseId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(maxRows);
  if (error) throw new Error(`results_read_failed:${dbErrorCode(error)}`);
  const parsed = z.array(resultListRow).safeParse(data ?? []);
  if (!parsed.success) throw new Error("results_read_failed:shape");
  const names = await readNames(client, parsed.data.map((row) => row.profile_id), deps.crypto);
  const settled = await Promise.allSettled(
    parsed.data.map(async (row): Promise<ResultRow> => ({
      profileId: row.profile_id,
      name: names.get(row.profile_id) ?? null,
      houseId: row.house_key,
      totem: await deps.crypto.decrypt(row.totem_enc, { table: "questionnaire_results", column: "totem_enc", rowId: row.profile_id }),
      createdAt: row.created_at,
    })),
  );
  const rows = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
  return { rows, unreadable: settled.length - rows.length };
}

export type OpenedResult =
  | { status: "ok"; name: string | null; result: QuestionnaireResultView }
  | { status: "not_found" }
  | { status: "unreadable" };

/**
 * Abre o resultado de uma pessoa: lê (a RLS decide), registra o acesso (o banco só aceita quem pode
 * ler os dados dela) e devolve o gráfico completo. Sem resultado visível ou com o registro recusado:
 * `not_found`, igual para quem não tem permissão e para quem não existe.
 */
export async function openResult(client: HouseClient, personId: string, deps: ViewDeps): Promise<OpenedResult> {
  if (!uuid.safeParse(personId).success) return { status: "not_found" };
  let result: QuestionnaireResultView | null;
  try {
    result = await readQuestionnaireResultOf(client, personId, deps.crypto, deps.questionnaire);
  } catch {
    return { status: "unreadable" };
  }
  if (!result) return { status: "not_found" };
  const logged = await client.rpc("log_questionnaire_view", { p_target: personId });
  if (logged.error) return { status: "not_found" };
  const names = await readNamesOne(client, personId, deps.crypto);
  return { status: "ok", name: names, result };
}

async function readNamesOne(client: HouseClient, id: string, crypto: CoordinationCrypto): Promise<string | null> {
  const { data } = await client.from("profiles").select("id,display_name_enc").eq("id", id).maybeSingle();
  const row = z.object({ id: z.string(), display_name_enc: z.string() }).safeParse(data);
  if (!row.success) return null;
  try {
    return await crypto.decrypt(row.data.display_name_enc, { table: "profiles", column: "display_name_enc", rowId: row.data.id });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Fila de análise
// ---------------------------------------------------------------------------------------
export type CaseRow = { requestId: string; profileId: string; name: string | null; tiedAxes: string[]; createdAt: string };

/** Casos inconclusivos abertos visíveis a quem chama (nome, data, eixos empatados). Ilegíveis, contados. */
export async function listCases(client: HouseClient, deps: ViewDeps): Promise<{ rows: CaseRow[]; unreadable: number }> {
  const { requests, unreadable } = await listOpenAnalysisRequests(client, deps.crypto);
  const names = await readNames(client, requests.map((request) => request.profileId), deps.crypto);
  const rows = requests
    .map((request) => ({
      requestId: request.requestId,
      profileId: request.profileId,
      name: names.get(request.profileId) ?? null,
      tiedAxes: request.tiedAxes,
      createdAt: request.createdAt,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { rows, unreadable };
}

export type OpenedCase =
  | {
      status: "ok";
      requestId: string;
      profileId: string;
      name: string | null;
      tiedAxes: string[];
      createdAt: string;
      answers: Record<string, number>;
      scores: AxisScores;
      chart: ChartAxis[];
    }
  | { status: "not_found" }
  | { status: "unreadable" };

/** Abre um caso: as respostas, as notas refeitas e o gráfico completo; registra o acesso à pessoa. */
export async function openCase(client: HouseClient, requestId: string, deps: ViewDeps): Promise<OpenedCase> {
  if (!uuid.safeParse(requestId).success) return { status: "not_found" };
  const { requests } = await listOpenAnalysisRequests(client, deps.crypto);
  const found = requests.find((request) => request.requestId === requestId);
  if (!found) {
    // Pode ser inexistente, fechado, fora do escopo ou ilegível: sem como distinguir daqui, e a tela não precisa.
    return { status: "not_found" };
  }
  let scores: AxisScores;
  try {
    scores = scoreQuestionnaire(deps.questionnaire, found.answers as never).scores;
  } catch {
    return { status: "unreadable" };
  }
  const logged = await client.rpc("log_questionnaire_view", { p_target: found.profileId });
  if (logged.error) return { status: "not_found" };
  return {
    status: "ok",
    requestId: found.requestId,
    profileId: found.profileId,
    name: await readNamesOne(client, found.profileId, deps.crypto),
    tiedAxes: found.tiedAxes,
    createdAt: found.createdAt,
    answers: found.answers,
    scores,
    chart: chartAxes(deps.questionnaire, scores, axisKeys),
  };
}

// ---------------------------------------------------------------------------------------
// Delegações (só a coordenação nacional lê todas; o banco decide)
// ---------------------------------------------------------------------------------------
const grantRow = z.object({
  id: z.string(),
  grantee_id: z.string(),
  unit_id: z.string(),
  granted_at: z.string(),
  unit: z.object({ name: z.string() }),
});
const candidateRow = z.object({
  profile_id: z.string(),
  unit_id: z.string(),
  unit: z.object({ name: z.string(), parent_id: z.string().nullable() }),
});

export type DelegationRow = { grantId: string; granteeId: string; granteeName: string | null; unitId: string; unitName: string; grantedAt: string };
export type CandidateRow = { granteeId: string; granteeName: string | null; unitId: string; unitName: string };

/** Concessões ativas (não revogadas), com o nome do gestor e da unidade. */
export async function listDelegations(client: HouseClient, deps: ViewDeps): Promise<DelegationRow[]> {
  const { data, error } = await client
    .from("questionnaire_data_grants")
    .select("id,grantee_id,unit_id,granted_at,unit:units!inner(name)")
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });
  if (error) throw new Error(`delegations_read_failed:${dbErrorCode(error)}`);
  const rows = z.array(grantRow).parse(data ?? []);
  const names = await readNames(client, rows.map((row) => row.grantee_id), deps.crypto);
  return rows.map((row) => ({
    grantId: row.id,
    granteeId: row.grantee_id,
    granteeName: names.get(row.grantee_id) ?? null,
    unitId: row.unit_id,
    unitName: row.unit.name,
    grantedAt: row.granted_at,
  }));
}

/** Gestores ativos de unidade abaixo da raiz: quem pode receber uma delegação. */
export async function listDelegationCandidates(client: HouseClient, deps: ViewDeps): Promise<CandidateRow[]> {
  const { data, error } = await client
    .from("role_assignments")
    .select("profile_id,unit_id,unit:units!inner(name,parent_id)")
    .eq("role", "manager")
    .is("revoked_at", null)
    .not("unit.parent_id", "is", null);
  if (error) throw new Error(`delegations_read_failed:${dbErrorCode(error)}`);
  const rows = z.array(candidateRow).parse(data ?? []);
  const names = await readNames(client, rows.map((row) => row.profile_id), deps.crypto);
  return rows.map((row) => ({ granteeId: row.profile_id, granteeName: names.get(row.profile_id) ?? null, unitId: row.unit_id, unitName: row.unit.name }));
}
