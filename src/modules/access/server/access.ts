// Lista de autorizados, primeiro login e fila de espera no servidor (ADR 0008 §1, #26).
// O e-mail só existe aqui, em memória: vira HMAC (src/server/crypto) e é descartado. Nada
// deste arquivo loga, e os erros não citam e-mail (R11).
import "server-only";
import { z } from "zod";
import { accessStatuses } from "@/modules/profiles";
import { decryptField, emailBlindIndex } from "@/server/crypto";
import { parseAllowlistCsv } from "../domain/allowlist-csv";
import type {
  AccessRpc,
  AllowlistImportResult,
  AllowlistSource,
  ResolvedAccess,
  WaitlistDecision,
  WaitlistEntry,
} from "../types";

type BlindIndex = (email: string) => Promise<string>;
type Decrypt = typeof decryptField;

const sourceSchema = z.enum(["form", "academy", "manual"]);
const decisionSchema = z.enum(["active", "blocked"]);
const resolvedSchema = z.enum(accessStatuses).nullable();
const waitlistRowsSchema = z.array(
  z.object({
    profile_id: z.guid(),
    display_name_enc: z.string(),
    municipality_code: z.number().int(),
    state_code: z.string(),
    created_at: z.string(),
  }),
);

/**
 * Chamar logo depois do login (e de novo depois de criar o perfil, se ele ainda não existia).
 * Calcula o HMAC do e-mail da sessão e pede ao banco a decisão, que vale só para o perfil de
 * quem está logado e só uma vez (`pending` → `active` ou `waitlisted`). Devolve o estado de
 * acesso; com `waitlisted`, a interface mostra a tela de espera.
 *
 * `email` precisa vir da sessão verificada pelo servidor, nunca de um campo do formulário.
 */
export async function resolveAccessAfterSignIn(
  rpc: AccessRpc,
  sessionEmail: string,
  blindIndex: BlindIndex = emailBlindIndex,
): Promise<ResolvedAccess> {
  const emailHmac = await blindIndex(sessionEmail);
  return resolvedSchema.parse(await rpc("resolve_access", { p_email_hmac: emailHmac }));
}

/**
 * Importação da lista pelo gestor: lê o CSV, calcula o HMAC de cada e-mail e envia só os
 * HMACs. O banco confere se quem chama é o gestor da raiz e grava `allowlist_imported` no
 * `audit_log` com a quantidade.
 */
export async function importAllowlist(
  rpc: AccessRpc,
  csv: string,
  source: AllowlistSource,
  blindIndex: BlindIndex = emailBlindIndex,
): Promise<AllowlistImportResult> {
  const validSource = sourceSchema.parse(source);
  const { emails, invalidLines } = parseAllowlistCsv(csv);
  const hmacs = [...new Set(await Promise.all(emails.map((email) => blindIndex(email))))];
  const received = z.number().int().nonnegative().parse(
    await rpc("import_allowlist", { p_email_hmacs: hmacs, p_source: validSource }),
  );
  return { received, invalidLines };
}

/** Fila de espera do gestor (só quem está no escopo dele), com o nome decifrado. */
export async function listWaitlist(rpc: AccessRpc, decrypt: Decrypt = decryptField): Promise<WaitlistEntry[]> {
  const rows = waitlistRowsSchema.parse(await rpc("list_waitlist", {}));
  return Promise.all(
    rows.map(async (row) => ({
      profileId: row.profile_id,
      displayName: await decrypt(row.display_name_enc, {
        table: "profiles",
        column: "display_name_enc",
        rowId: row.profile_id,
      }),
      municipalityCode: row.municipality_code,
      stateCode: row.state_code,
      createdAt: row.created_at,
    })),
  );
}

/** Aprova (`active`) ou bloqueia (`blocked`) quem está na espera; o banco audita a decisão. */
export async function decideAccess(
  rpc: AccessRpc,
  profileId: string,
  decision: WaitlistDecision,
): Promise<WaitlistDecision> {
  const args = { p_profile: z.guid().parse(profileId), p_decision: decisionSchema.parse(decision) };
  return decisionSchema.parse(await rpc("decide_access", args));
}
