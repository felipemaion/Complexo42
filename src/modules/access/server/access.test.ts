// Serviço da lista de autorizados (#26): o e-mail vira HMAC antes de sair do servidor, o banco
// recebe só HMACs e as respostas dele são validadas. O banco (permissões, auditoria) é testado
// em supabase/tests/access_allowlist.test.sql.
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailBlindIndexWith, normalizeEmail } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";
import { decideAccess, importAllowlist, listWaitlist, resolveAccessAfterSignIn } from "./access";
import type { AccessRpc } from "../types";

const key = () => crypto.getRandomValues(new Uint8Array(32));
const keyring = importKeyring({ fieldKeys: new Map([[1, key()]]), currentVersion: 1, blindIndexKey: key() });
const blindIndex = async (email: string) => emailBlindIndexWith(await keyring, email);

type Call = { fn: string; args: Record<string, unknown> };
function fakeRpc(answer: unknown): { rpc: AccessRpc; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return answer;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("resolveAccessAfterSignIn", () => {
  it("envia só o HMAC do e-mail da sessão (domínio em:, normalizado) e devolve o estado", async () => {
    const { rpc, calls } = fakeRpc("active");
    expect(await resolveAccessAfterSignIn(rpc, " Maria@Exemplo.org", blindIndex)).toBe("active");
    expect(calls).toEqual([{ fn: "resolve_access", args: { p_email_hmac: await blindIndex("maria@exemplo.org") } }]);
    expect(JSON.stringify(calls)).not.toMatch(/maria|@/i);
    expect(calls[0]?.args.p_email_hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("devolve waitlisted e nulo (sem perfil) como o banco responder", async () => {
    expect(await resolveAccessAfterSignIn(fakeRpc("waitlisted").rpc, "a@x.org", blindIndex)).toBe("waitlisted");
    expect(await resolveAccessAfterSignIn(fakeRpc(null).rpc, "a@x.org", blindIndex)).toBeNull();
  });

  it("recusa resposta inesperada do banco", async () => {
    await expect(resolveAccessAfterSignIn(fakeRpc("admin").rpc, "a@x.org", blindIndex)).rejects.toThrow();
  });

  it("e-mail inválido falha antes de chamar o banco, sem citar o e-mail", async () => {
    const { rpc, calls } = fakeRpc("active");
    const error = await resolveAccessAfterSignIn(rpc, "fulano sem arroba", blindIndex).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/fulano/);
    expect(calls).toEqual([]);
  });
});

describe("importAllowlist", () => {
  it("envia só HMACs distintos, nunca os e-mails nem as outras colunas", async () => {
    const { rpc, calls } = fakeRpc(2);
    const log = vi.spyOn(console, "log");
    const csv = "Nome,Email\nMaria Silva,Maria@Exemplo.org\nJoão,joao@exemplo.org\nMaria,maria@exemplo.org\nZé,ze@\n";
    const result = await importAllowlist(rpc, csv, "academy", blindIndex);

    expect(result).toEqual({ received: 2, invalidLines: [5] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe("import_allowlist");
    expect(calls[0]?.args.p_source).toBe("academy");
    expect(calls[0]?.args.p_email_hmacs).toEqual([
      await blindIndex(normalizeEmail("maria@exemplo.org")),
      await blindIndex("joao@exemplo.org"),
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/maria|joao|silva|@/i);
    expect(log).not.toHaveBeenCalled();
  });

  it("origem inválida e arquivo vazio não chegam ao banco", async () => {
    const { rpc, calls } = fakeRpc(1);
    // @ts-expect-error origem fora do enum, como viria de um formulário adulterado
    await expect(importAllowlist(rpc, "a@x.org", "planilha", blindIndex)).rejects.toThrow();
    await expect(importAllowlist(rpc, "email\n", "manual", blindIndex)).rejects.toMatchObject({ code: "empty" });
    expect(calls).toEqual([]);
  });

  it("propaga a recusa do banco (quem não é gestor)", async () => {
    const rpc: AccessRpc = async () => {
      throw new Error("permission denied");
    };
    await expect(importAllowlist(rpc, "a@x.org", "manual", blindIndex)).rejects.toThrow("permission denied");
  });
});

describe("fila de espera", () => {
  const row = {
    profile_id: "00000000-0000-0000-0000-0000000000ca",
    display_name_enc: "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB",
    municipality_code: 3550308,
    state_code: "SP",
    created_at: "2026-11-19T12:00:00+00:00",
  };

  it("lista com o nome decifrado no contexto profiles.display_name_enc do próprio perfil", async () => {
    const decrypt = vi.fn(async () => "Maria");
    const { rpc, calls } = fakeRpc([row]);
    expect(await listWaitlist(rpc, decrypt)).toEqual([
      { profileId: row.profile_id, displayName: "Maria", municipalityCode: 3550308, stateCode: "SP", createdAt: row.created_at },
    ]);
    expect(calls).toEqual([{ fn: "list_waitlist", args: {} }]);
    expect(decrypt).toHaveBeenCalledWith(row.display_name_enc, {
      table: "profiles",
      column: "display_name_enc",
      rowId: row.profile_id,
    });
  });

  it("aprova ou bloqueia com id e decisão validados", async () => {
    const { rpc, calls } = fakeRpc("blocked");
    expect(await decideAccess(rpc, row.profile_id, "blocked")).toBe("blocked");
    expect(calls).toEqual([{ fn: "decide_access", args: { p_profile: row.profile_id, p_decision: "blocked" } }]);
  });

  it("recusa id que não é uuid e decisão fora de active/blocked sem chamar o banco", async () => {
    const { rpc, calls } = fakeRpc("active");
    await expect(decideAccess(rpc, "1 or 1=1", "active")).rejects.toThrow();
    // @ts-expect-error decisão fora do enum
    await expect(decideAccess(rpc, row.profile_id, "pending")).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
