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
import {
  type AnalysisKind,
  listOpenAnalysisRequests,
  readOpenAnalysisRequest,
  readQuestionnaireResultOf,
  type CoordinationCrypto,
  type QuestionnaireResultView,
} from "./coordination";

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

/** Ids por consulta de nomes: a URL do PostgREST não aguenta centenas de uuids de uma vez. */
const nameBatchSize = 50;

/**
 * Nomes decifrados por id, em lotes. Falha ao ler vira erro visível (a tela cai), em vez de mostrar
 * todo mundo sem nome; nome que só não decifra vira `null`.
 */
async function readNames(client: HouseClient, ids: readonly string[], crypto: CoordinationCrypto): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += nameBatchSize) {
    const { data, error } = await client.from("profiles").select("id,display_name_enc").in("id", unique.slice(start, start + nameBatchSize));
    if (error) throw new Error(`names_read_failed:${dbErrorCode(error)}`);
    const rows = nameRows.safeParse(data ?? []);
    if (!rows.success) throw new Error("names_read_failed:shape");
    await Promise.all(
      rows.data.map(async (row) => {
        try {
          names.set(row.id, await crypto.decrypt(row.display_name_enc, { table: "profiles", column: "display_name_enc", rowId: row.id }));
        } catch {
          names.set(row.id, null);
        }
      }),
    );
  }
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
const resultListRow = z.object({ profile_id: z.string(), house_key: z.string(), created_at: z.string() });

/**
 * Uma pessoa na lista: nome, casa sugerida (do resultado), casa escolhida (vínculo aberto; nula se ainda
 * não aceitou), quando e se a troca foi da coordenação. Totem e notas ficam no detalhe, que registra o acesso.
 */
export type ResultRow = {
  profileId: string;
  name: string | null;
  houseId: string;
  createdAt: string;
  chosenHouseId: string | null;
  chosenAt: string | null;
  changedByCoordinationAt: string | null;
};

/** A casa escolhida é outra que a sugerida (só com casa escolhida). */
export function choseOtherHouse(row: { houseId: string; chosenHouseId: string | null }): boolean {
  return row.chosenHouseId !== null && row.chosenHouseId !== row.houseId;
}

export type HouseChoice = { houseId: string | null; chosenAt: string | null; changedByCoordinationAt: string | null };

const chosenRow = z.object({
  profile_id: z.string(),
  house_key: z.string().nullable(),
  chosen_at: z.string().nullable(),
  changed_by_coordination_at: z.string().nullable(),
});

/** A casa escolhida das pessoas pedidas, pela função do banco (mesmo alcance das telas de resultado). */
async function readChosenHouses(client: HouseClient, ids: readonly string[]): Promise<Map<string, HouseChoice>> {
  const choices = new Map<string, HouseChoice>();
  if (ids.length === 0) return choices;
  const { data, error } = await client.rpc("coordination_chosen_houses", { p_profiles: [...ids] });
  if (error) throw new Error(`results_read_failed:${dbErrorCode(error)}`);
  const parsed = z.array(chosenRow).safeParse(data ?? []);
  if (!parsed.success) throw new Error("results_read_failed:shape");
  for (const row of parsed.data) {
    choices.set(row.profile_id, { houseId: row.house_key, chosenAt: row.chosen_at, changedByCoordinationAt: row.changed_by_coordination_at });
  }
  return choices;
}

/** Pessoas por página da lista; passando disso, mostra as mais recentes e avisa (filtre por casa). */
export const maxResultRows = 200;

/**
 * Pessoas com resultado que a RLS deixa ver a quem chama (nacional: todas as ativas; delegado: as do
 * escopo), das mais novas, SEM a própria pessoa. A lista não traz totem nem nota (nem os pede ao banco):
 * eles só aparecem ao abrir a pessoa, o que registra o acesso. `houseId` filtra pela casa (só casas da
 * config); `truncated` avisa que havia mais que a página.
 */
export async function listResults(
  client: HouseClient,
  deps: ViewDeps,
  viewerId: string,
  filter: { houseId?: string; otherHouse?: boolean },
): Promise<{ rows: ResultRow[]; truncated: boolean }> {
  const houseId = filter.houseId !== undefined && instance.houses.some((house) => house.id === filter.houseId) ? filter.houseId : undefined;
  let data: unknown;
  let error: unknown;
  if (filter.otherHouse) {
    // "Escolheu outra casa" é filtrado no banco, sobre todas as pessoas do alcance (não só a página).
    ({ data, error } = await client.rpc("coordination_other_house_results", { p_house: houseId ?? null, p_limit: maxResultRows + 1 }));
  } else {
    let query = client.from("questionnaire_results").select("profile_id,house_key,created_at").neq("profile_id", viewerId);
    if (houseId !== undefined) query = query.eq("house_key", houseId);
    ({ data, error } = await query.order("created_at", { ascending: false }).limit(maxResultRows + 1));
  }
  if (error) throw new Error(`results_read_failed:${dbErrorCode(error)}`);
  const parsed = z.array(resultListRow).safeParse(data ?? []);
  if (!parsed.success) throw new Error("results_read_failed:shape");
  const page = parsed.data.slice(0, maxResultRows);
  const ids = page.map((row) => row.profile_id);
  const names = await readNames(client, ids, deps.crypto);
  const choices = await readChosenHouses(client, ids);
  const rows = page.map((row) => {
    const choice = choices.get(row.profile_id);
    return {
      profileId: row.profile_id,
      name: names.get(row.profile_id) ?? null,
      houseId: row.house_key,
      createdAt: row.created_at,
      chosenHouseId: choice?.houseId ?? null,
      chosenAt: choice?.chosenAt ?? null,
      changedByCoordinationAt: choice?.changedByCoordinationAt ?? null,
    };
  });
  return { rows, truncated: parsed.data.length > maxResultRows };
}

export type OpenedResult =
  | { status: "ok"; name: string | null; result: QuestionnaireResultView; choice: HouseChoice }
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
  let choice: HouseChoice;
  try {
    choice = (await readChosenHouses(client, [personId])).get(personId) ?? { houseId: null, chosenAt: null, changedByCoordinationAt: null };
  } catch {
    return { status: "unreadable" };
  }
  return { status: "ok", name: names, result, choice };
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
export type CaseRow = { requestId: string; profileId: string; name: string | null; kind: AnalysisKind; tiedAxes: string[]; createdAt: string };

/** Casos inconclusivos abertos visíveis a quem chama (nome, data, eixos empatados). Ilegíveis, contados. */
export async function listCases(client: HouseClient, deps: ViewDeps): Promise<{ rows: CaseRow[]; unreadable: number; truncated: boolean }> {
  const { requests, unreadable, truncated } = await listOpenAnalysisRequests(client, deps.crypto);
  const names = await readNames(client, requests.map((request) => request.profileId), deps.crypto);
  const rows = requests
    .map((request) => ({
      requestId: request.requestId,
      profileId: request.profileId,
      name: names.get(request.profileId) ?? null,
      kind: request.kind,
      tiedAxes: request.tiedAxes,
      createdAt: request.createdAt,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { rows, unreadable, truncated };
}

export type OpenedCase =
  | {
      status: "ok";
      requestId: string;
      profileId: string;
      name: string | null;
      kind: AnalysisKind;
      /** Em pedido de totem, a casa já definida pelos eixos 1 e 2 (a coordenação decide só o totem). */
      houseId: string | null;
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
  // Só este pedido (id e status no banco): não decifra a fila inteira para abrir um caso.
  const one = await readOpenAnalysisRequest(client, requestId, deps.crypto);
  if (one.status !== "ok") return one;
  const found = one.request;
  let scores: AxisScores;
  try {
    scores = scoreQuestionnaire(deps.questionnaire, found.answers as never).scores;
  } catch {
    return { status: "unreadable" };
  }
  let houseId: string | null = null;
  if (found.kind === "totem") {
    // A casa já saiu: sem o resultado (ilegível ou sumido) o caso não tem como ser resolvido só no totem.
    try {
      houseId = (await readQuestionnaireResultOf(client, found.profileId, deps.crypto, deps.questionnaire))?.houseId ?? null;
    } catch {
      houseId = null;
    }
    if (houseId === null) return { status: "unreadable" };
  }
  const logged = await client.rpc("log_questionnaire_view", { p_target: found.profileId });
  if (logged.error) return { status: "not_found" };
  return {
    status: "ok",
    requestId: found.requestId,
    profileId: found.profileId,
    name: await readNamesOne(client, found.profileId, deps.crypto),
    kind: found.kind,
    houseId,
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
