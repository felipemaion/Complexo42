// Cola das telas da coordenação do questionário (#174): sessão (JWT de quem está logado, R14), a
// permissão que o banco informa e as dependências do servidor (questionário real e cifra). Quem não
// tem permissão recebe 404, igual a uma página que não existe (nada diz que a tela existe). A
// permissão só decide o que mostrar: ler, resolver e delegar continuam sendo decididos pelo banco.
import "server-only";
import { notFound } from "next/navigation";
import { decryptField, encryptField } from "@/server/crypto";
import { requireUser, type CurrentUser } from "@/server/auth/session";
import type { HouseClient } from "../types";
import { canSeeResults, readCoordinationAccess, type CoordinationAccess, type ViewDeps } from "./coordination-views";
import { getQuestionnaire } from "./questionnaire";
import { sessionHouseClient } from "./session";

/** O que o servidor entrega às telas: o questionário da config e a cifra (ADR 0003). */
export function coordinationViewDeps(): ViewDeps {
  return { crypto: { encrypt: encryptField, decrypt: decryptField }, questionnaire: getQuestionnaire() };
}

export type CoordinationScreen = { user: CurrentUser; client: HouseClient; access: CoordinationAccess; deps: ViewDeps };

/**
 * Entrada de uma tela. `results` (resultados e fila): a nacional ou um delegado. `delegations`: só a
 * nacional. Sem sessão, o `requireUser` leva ao login; sem permissão, 404.
 */
export async function requireCoordinationScreen(screen: "results" | "delegations"): Promise<CoordinationScreen> {
  const user = await requireUser();
  const client = await sessionHouseClient();
  if (!client) notFound();
  const access = await readCoordinationAccess(client);
  const allowed = screen === "delegations" ? access.national : canSeeResults(access);
  if (!allowed) notFound();
  return { user, client, access, deps: coordinationViewDeps() };
}

/** Só o que o menu precisa: os atalhos que a pessoa pode ver. */
export async function readCoordinationLinks(): Promise<CoordinationAccess> {
  const client = await sessionHouseClient();
  return client ? readCoordinationAccess(client) : { national: false, delegate: false };
}
