// Serviço da lista de autorizados (#26): o e-mail vem da sessão (confirmado), vira HMAC antes
// de sair do servidor, o banco recebe só HMACs e as respostas dele são validadas. O banco
// (permissões, auditoria) é testado em supabase/tests/access_allowlist.test.sql.
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailBlindIndexWith } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";
import { decideAccess, importAllowlist, listWaitlist, resolveAccessAfterSignIn } from "./access";
import { AccessError, type AccessClient, type SessionUser } from "../types";

const key = () => crypto.getRandomValues(new Uint8Array(32));
const keyring = importKeyring({ fieldKeys: new Map([[1, key()]]), currentVersion: 1, blindIndexKey: key() });
const blindIndex = async (email: string) => emailBlindIndexWith(await keyring, email);

const confirmed: SessionUser = { email: " Maria@Exemplo.org", email_confirmed_at: "2026-11-19T10:00:00Z" };

type Call = { fn: string; args: Record<string, unknown> };
function fakeClient(
  answer: unknown,
  opts: { user?: SessionUser | null; authError?: unknown; dbError?: unknown } = {},
): { client: AccessClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      auth: {
        getUser: async () => ({
          data: { user: opts.user === undefined ? confirmed : opts.user },
          error: opts.authError ?? null,
        }),
      },
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return opts.dbError ? { data: null, error: opts.dbError } : { data: answer, error: null };
      },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("resolveAccessAfterSignIn", () => {
  it("usa o e-mail da sessão e envia só o HMAC dele (domínio em:, normalizado)", async () => {
    const { client, calls } = fakeClient("active");
    expect(await resolveAccessAfterSignIn(client, blindIndex)).toBe("active");
    expect(calls).toEqual([{ fn: "resolve_access", args: { p_email_hmac: await blindIndex("maria@exemplo.org") } }]);
    expect(JSON.stringify(calls)).not.toMatch(/maria|@/i);
    expect(calls[0]?.args.p_email_hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("devolve waitlisted e nulo (sem perfil) como o banco responder", async () => {
    expect(await resolveAccessAfterSignIn(fakeClient("waitlisted").client, blindIndex)).toBe("waitlisted");
    expect(await resolveAccessAfterSignIn(fakeClient(null).client, blindIndex)).toBeNull();
  });

  it("e-mail não confirmado: recusa sem chamar o banco", async () => {
    for (const user of [
      { email: "maria@exemplo.org", email_confirmed_at: null },
      { email: "maria@exemplo.org" },
      { email: null, email_confirmed_at: "2026-11-19T10:00:00Z" },
    ]) {
      const { client, calls } = fakeClient("active", { user });
      await expect(resolveAccessAfterSignIn(client, blindIndex)).rejects.toMatchObject({ code: "email_not_confirmed" });
      expect(calls).toEqual([]);
    }
  });

  it("sem sessão (ou sessão inválida no Auth): recusa sem chamar o banco", async () => {
    for (const opts of [{ user: null }, { authError: new Error("JWT expired") }]) {
      const { client, calls } = fakeClient("active", opts);
      const error = await resolveAccessAfterSignIn(client, blindIndex).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccessError);
      expect(error).toMatchObject({ code: "no_session" });
      expect(calls).toEqual([]);
    }
  });

  it("recusa resposta inesperada do banco e não repassa o texto do erro do banco", async () => {
    await expect(resolveAccessAfterSignIn(fakeClient("admin").client, blindIndex)).rejects.toThrow();
    const failing = fakeClient(null, { dbError: { message: "detalhe interno maria@exemplo.org" } }).client;
    const error = (await resolveAccessAfterSignIn(failing, blindIndex).catch((e: unknown) => e)) as AccessError;
    expect(error.code).toBe("db_error");
    expect(error.message).not.toMatch(/maria|interno/);
  });
});

describe("importAllowlist", () => {
  it("envia só HMACs distintos, nunca os e-mails nem as outras colunas", async () => {
    const { client, calls } = fakeClient({ received: 2, promoted: 1 });
    const log = vi.spyOn(console, "log");
    const csv = "Nome,Email\nMaria Silva,Maria@Exemplo.org\nJoão,joao@exemplo.org\nMaria,maria@exemplo.org\nZé,ze@\n";
    const result = await importAllowlist(client, csv, "academy", blindIndex);

    expect(result).toEqual({ received: 2, promoted: 1, invalidLines: [5] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe("import_allowlist");
    expect(calls[0]?.args.p_source).toBe("academy");
    expect(calls[0]?.args.p_email_hmacs).toEqual([
      await blindIndex("maria@exemplo.org"),
      await blindIndex("joao@exemplo.org"),
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/maria|joao|silva|@/i);
    expect(log).not.toHaveBeenCalled();
  });

  it("origem inválida e arquivo vazio não chegam ao banco", async () => {
    const { client, calls } = fakeClient(1);
    // @ts-expect-error origem fora do enum, como viria de um formulário adulterado
    await expect(importAllowlist(client, "a@x.org", "planilha", blindIndex)).rejects.toThrow();
    await expect(importAllowlist(client, "email\n", "manual", blindIndex)).rejects.toMatchObject({ code: "empty" });
    expect(calls).toEqual([]);
  });

  it("recusa resposta do banco fora do formato {received, promoted}", async () => {
    await expect(importAllowlist(fakeClient(2).client, "a@x.org", "manual", blindIndex)).rejects.toThrow();
  });

  it("propaga a recusa do banco (quem não é gestor)", async () => {
    const { client } = fakeClient(null, { dbError: { code: "42501" } });
    await expect(importAllowlist(client, "a@x.org", "manual", blindIndex)).rejects.toMatchObject({ code: "db_error" });
  });
});

describe("fila de espera", () => {
  const row = (n: number) => ({
    profile_id: `00000000-0000-0000-0000-0000000000c${n}`,
    display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
    municipality_code: 3550308,
    state_code: "SP",
    created_at: `2026-11-19T12:00:0${n}+00:00`,
  });

  it("lista uma página com o nome decifrado no contexto profiles.display_name_enc", async () => {
    const decrypt = vi.fn(async () => "Maria");
    const { client, calls } = fakeClient([row(1)]);
    expect(await listWaitlist(client, {}, decrypt)).toEqual({
      entries: [
        { profileId: row(1).profile_id, displayName: "Maria", municipalityCode: 3550308, stateCode: "SP", createdAt: row(1).created_at },
      ],
      nextCursor: null,
    });
    expect(calls).toEqual([
      { fn: "list_waitlist", args: { p_limit: 50, p_after_created_at: null, p_after_id: null } },
    ]);
    expect(decrypt).toHaveBeenCalledWith(row(1).display_name_enc, {
      table: "profiles",
      column: "display_name_enc",
      rowId: row(1).profile_id,
    });
  });

  it("página cheia devolve o cursor do último item, que vai na chamada seguinte", async () => {
    const decrypt = async () => "x";
    const first = await listWaitlist(fakeClient([row(1), row(2)]).client, { limit: 2 }, decrypt);
    expect(first.nextCursor).toEqual({ createdAt: row(2).created_at, profileId: row(2).profile_id });

    const { client, calls } = fakeClient([row(3)]);
    const second = await listWaitlist(client, { limit: 2, after: first.nextCursor! }, decrypt);
    expect(calls[0]?.args).toEqual({ p_limit: 2, p_after_created_at: row(2).created_at, p_after_id: row(2).profile_id });
    expect(second.nextCursor).toBeNull();
  });

  it("recusa limite fora de 1..200 e cursor inválido sem chamar o banco", async () => {
    const { client, calls } = fakeClient([]);
    await expect(listWaitlist(client, { limit: 0 })).rejects.toThrow();
    await expect(listWaitlist(client, { limit: 201 })).rejects.toThrow();
    await expect(listWaitlist(client, { after: { createdAt: "x", profileId: "1 or 1=1" } })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("aprova ou bloqueia com id e decisão validados", async () => {
    const { client, calls } = fakeClient("blocked");
    expect(await decideAccess(client, row(1).profile_id, "blocked")).toBe("blocked");
    expect(calls).toEqual([{ fn: "decide_access", args: { p_profile: row(1).profile_id, p_decision: "blocked" } }]);
  });

  it("recusa id que não é uuid e decisão fora de active/blocked sem chamar o banco", async () => {
    const { client, calls } = fakeClient("active");
    await expect(decideAccess(client, "1 or 1=1", "active")).rejects.toThrow();
    // @ts-expect-error decisão fora do enum
    await expect(decideAccess(client, row(1).profile_id, "pending")).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
