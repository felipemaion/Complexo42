// Lista de autorizados, primeiro login e fila de espera no servidor (ADR 0008 §1, #26).
// O e-mail só existe aqui, em memória: vira HMAC (src/server/crypto) e é descartado. O único
// log daqui é a falha ao decifrar um nome da fila, só com o código do erro e o id do perfil;
// os erros não citam e-mail (R11).
import "server-only";
import { z } from "zod";
import { accessStatuses } from "@/modules/profiles";
import { decryptField, emailBlindIndex } from "@/server/crypto";
import { log } from "@/server/log";
import { normalizeAllowlistEmail, parseAllowlistCsv } from "../domain/allowlist-csv";
import type { MemberBlockRequest } from "../domain/member-block";
import {
  AccessError,
  type AccessClient,
  type AllowlistImportResult,
  type AllowlistSource,
  type ResolvedAccess,
  type WaitlistCursor,
  type WaitlistDecision,
  type WaitlistPage,
} from "../types";

type BlindIndex = (email: string) => Promise<string>;
type Decrypt = typeof decryptField;

/** Teto de itens por página da fila; o banco aplica o mesmo (`list_waitlist`). */
export const waitlistPageLimit = { default: 50, max: 200 } as const;

const sourceSchema = z.enum(["form", "academy", "manual"]);
const decisionSchema = z.enum(["active", "blocked"]);
const resolvedSchema = z.enum(accessStatuses).nullable();
const waitlistRowsSchema = z.array(
  z.object({
    profile_id: z.guid(),
    // Nulos: pessoa de perfil incompleto que foi bloqueada e desbloqueada (ADR 0017); a fila a mostra assim mesmo.
    display_name_enc: z.string().nullable(),
    municipality_code: z.number().int().nullable(),
    state_code: z.string().nullable(),
    created_at: z.string(),
  }),
);

/** Código (ou nome) do erro, curto, para o log; nunca a mensagem. */
function errorCodeOf(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "string") return code.slice(0, 32);
  return err instanceof Error ? err.name.slice(0, 32) : "unknown";
}

/**
 * Chama a RPC e devolve `data`; erro do banco vira `AccessError` sem o texto do banco. A
 * recusa de permissão (42501, `insufficient_privilege`) vira `forbidden`, para a tela
 * explicar em vez de mostrar uma falha genérica.
 */
async function callRpc(client: AccessClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    // 54000 (`program_limit_exceeded`): limite de tentativas do bloqueio.
    throw new AccessError(code === "42501" ? "forbidden" : code === "54000" ? "rate_limited" : "db_error");
  }
  return data;
}

/**
 * Chamar logo depois do login (e de novo depois de criar o perfil, se ele ainda não existia),
 * com o cliente do Supabase que carrega o JWT da sessão. O e-mail vem de `auth.getUser()`
 * (validado no servidor de Auth), nunca de um parâmetro: assim ninguém pede a decisão com o
 * e-mail de outra pessoa. E-mail não confirmado é recusado antes de chamar o banco, porque só
 * a confirmação prova que a conta é dona do e-mail.
 *
 * O banco decide só para o perfil de quem está logado e só uma vez (`pending` → `active` ou
 * `waitlisted`). Com `waitlisted`, a interface mostra a tela de espera (`/espera`).
 */
export async function resolveAccessAfterSignIn(
  client: AccessClient,
  blindIndex: BlindIndex = emailBlindIndex,
): Promise<ResolvedAccess> {
  const { data, error } = await client.auth.getUser();
  const user = error ? null : data.user;
  if (!user) throw new AccessError("no_session");
  if (!user.email || !user.email_confirmed_at) throw new AccessError("email_not_confirmed");
  const emailHmac = await blindIndex(user.email);
  return resolvedSchema.parse(await callRpc(client, "resolve_access", { p_email_hmac: emailHmac }));
}

/**
 * Importação da lista pelo gestor: lê o CSV, calcula o HMAC de cada e-mail e envia só os
 * HMACs. O banco confere se quem chama é o gestor da raiz e grava `allowlist_imported` no
 * `audit_log` com a quantidade. Quem estava na espera com um dos HMACs importados é liberado
 * na hora (`promoted`), com um `access_granted` (motivo `import`) por pessoa.
 */
export async function importAllowlist(
  client: AccessClient,
  csv: string,
  source: AllowlistSource,
  blindIndex: BlindIndex = emailBlindIndex,
): Promise<AllowlistImportResult> {
  const validSource = sourceSchema.parse(source);
  const { emails, invalidLines } = parseAllowlistCsv(csv);
  const hmacs = [...new Set(await Promise.all(emails.map((email) => blindIndex(email))))];
  const { received, promoted } = z
    .object({ received: z.number().int().nonnegative(), promoted: z.number().int().nonnegative() })
    .parse(await callRpc(client, "import_allowlist", { p_email_hmacs: hmacs, p_source: validSource }));
  return { received, promoted, invalidLines };
}

/**
 * Uma página da fila de espera do gestor (só quem está no escopo dele), dos mais antigos para
 * os mais novos, com o nome decifrado. Para a próxima página, passar `nextCursor`. Um nome que
 * não decifra (chave trocada, valor corrompido) vem como null, em vez de a fila inteira falhar
 * por causa de uma pessoa; a falha vai para o log (só código e id, nunca o valor cifrado nem a
 * mensagem) e a tela não deixa liberar quem não foi identificado.
 */
export async function listWaitlist(
  client: AccessClient,
  options: { limit?: number; after?: WaitlistCursor } = {},
  decrypt: Decrypt = decryptField,
): Promise<WaitlistPage> {
  const limit = z.number().int().min(1).max(waitlistPageLimit.max).parse(options.limit ?? waitlistPageLimit.default);
  const after = options.after
    ? z.object({ createdAt: z.string().min(1), profileId: z.guid() }).parse(options.after)
    : undefined;
  const rows = waitlistRowsSchema.parse(
    await callRpc(client, "list_waitlist", {
      p_limit: limit,
      p_after_created_at: after?.createdAt ?? null,
      p_after_id: after?.profileId ?? null,
    }),
  );
  const entries = await Promise.all(
    rows.map(async (row) => ({
      profileId: row.profile_id,
      displayName: row.display_name_enc === null ? null : await decrypt(row.display_name_enc, {
        table: "profiles",
        column: "display_name_enc",
        rowId: row.profile_id,
      }).catch((err: unknown) => {
        log.warn("waitlist_name_decrypt_failed", { profile_id: row.profile_id, reason: errorCodeOf(err) });
        return null;
      }),
      municipalityCode: row.municipality_code,
      stateCode: row.state_code,
      createdAt: row.created_at,
    })),
  );
  const last = entries.at(-1);
  return {
    entries,
    nextCursor: entries.length === limit && last ? { createdAt: last.createdAt, profileId: last.profileId } : null,
  };
}

/** Aprova (`active`) ou bloqueia (`blocked`) quem está na espera; o banco audita a decisão. */
export async function decideAccess(
  client: AccessClient,
  profileId: string,
  decision: WaitlistDecision,
): Promise<WaitlistDecision> {
  const args = { p_profile: z.guid().parse(profileId), p_decision: decisionSchema.parse(decision) };
  return decisionSchema.parse(await callRpc(client, "decide_access", args));
}

const memberBlockReasonSchema = z.enum(["impersonation", "conduct", "other"]).nullable();
const normalizedEmailSchema = z.string().refine((email) => normalizeAllowlistEmail(email) === email);

/**
 * Bloqueia quem está ativo (`block_member`) ou devolve à fila de espera quem está bloqueado
 * (`unblock_member`), pelo e-mail de login. O banco decide quem pode (R15) e responde igual
 * exista ou não a conta (neutra no retorno). A falta de papel de gestor vira `forbidden`; o
 * limite de tentativas por hora, `rate_limited`. O e-mail não vai para log nenhum (R11).
 */
export async function setMemberBlock(client: AccessClient, request: MemberBlockRequest): Promise<void> {
  const email = normalizedEmailSchema.parse(request.email);
  if (request.action === "unblock") {
    await callRpc(client, "unblock_member", { p_email: email });
    return;
  }
  await callRpc(client, "block_member", { p_email: email, p_reason: memberBlockReasonSchema.parse(request.reason) });
}
