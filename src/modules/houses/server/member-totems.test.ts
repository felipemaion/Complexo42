import { describe, expect, it, vi } from "vitest";
import type { HouseClient } from "../types";
import { memberTotemsBatch, readMemberTotems } from "./member-totems";

// Leitor do totem de membros (#303): chama `member_totems` com o cliente da sessão e DECIFRA no servidor, com o AAD
// da linha da pessoa. O navegador nunca recebe o texto cifrado: só o código validado contra a config.
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const questionnaire = { totemLabels: { XV: { name: "t1", description: "d" }, XW: { name: "t2", description: "d" }, YV: { name: "t3", description: "d" }, YW: { name: "t4", description: "d" } } };

type Rpc = { fn: string; args: Record<string, unknown> };
function fakeClient(result: { data?: unknown; error?: unknown }) {
  const calls: Rpc[] = [];
  const client: HouseClient = {
    rpc: (fn, args) => (calls.push({ fn, args }), Promise.resolve({ data: result.data ?? null, error: result.error ?? null })),
    from: () => {
      throw new Error("o leitor só usa a função, nunca a tabela");
    },
  };
  return { client, calls };
}
const crypto = (map: Record<string, string>) => ({
  decrypt: vi.fn(async (value: string) => {
    const plain = map[value];
    if (plain === undefined) throw new Error("decifra falhou");
    return plain;
  }),
});

describe("readMemberTotems", () => {
  it("pede só ao `member_totems` e decifra com o AAD da linha de cada pessoa", async () => {
    const { client, calls } = fakeClient({ data: [{ profile_id: A, totem_enc: "enc-a" }, { profile_id: B, totem_enc: "enc-b" }] });
    const deps = { crypto: crypto({ "enc-a": "XV", "enc-b": "YW" }), questionnaire };
    const out = await readMemberTotems(client, [A, B], deps);
    expect(out).toEqual(new Map([[A, "XV"], [B, "YW"]]));
    expect(calls).toEqual([{ fn: "member_totems", args: { p_profiles: [A, B] } }]);
    expect(deps.crypto.decrypt).toHaveBeenCalledWith("enc-a", { table: "questionnaire_results", column: "totem_enc", rowId: A });
    expect(deps.crypto.decrypt).toHaveBeenCalledWith("enc-b", { table: "questionnaire_results", column: "totem_enc", rowId: B });
  });

  it("sem ids, nem chama o banco; id repetido vai uma vez só", async () => {
    const none = fakeClient({ data: [] });
    expect(await readMemberTotems(none.client, [], { crypto: crypto({}), questionnaire })).toEqual(new Map());
    expect(none.calls).toEqual([]);
    const dup = fakeClient({ data: [] });
    await readMemberTotems(dup.client, [A, A, B], { crypto: crypto({}), questionnaire });
    expect(dup.calls).toEqual([{ fn: "member_totems", args: { p_profiles: [A, B] } }]);
  });

  it("falha de decifra, código fora da config e linha que ninguém pediu: sem medalha (falha fechado), só a contagem vai ao aviso", async () => {
    const { client } = fakeClient({
      data: [
        { profile_id: A, totem_enc: "enc-ruim" },
        { profile_id: B, totem_enc: "enc-b" },
        { profile_id: "00000000-0000-4000-8000-0000000000ff", totem_enc: "enc-a" },
      ],
    });
    const onUnreadable = vi.fn();
    const out = await readMemberTotems(client, [A, B], { crypto: crypto({ "enc-b": "ZZ", "enc-a": "XV" }), questionnaire, onUnreadable });
    expect(out).toEqual(new Map());
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    expect(onUnreadable).toHaveBeenCalledWith(2);
    expect(JSON.stringify(onUnreadable.mock.calls)).not.toMatch(/enc-|0000000000/);
  });

  it("sem linha ilegível, não avisa", async () => {
    const { client } = fakeClient({ data: [{ profile_id: A, totem_enc: "enc-a" }] });
    const onUnreadable = vi.fn();
    await readMemberTotems(client, [A], { crypto: crypto({ "enc-a": "XW" }), questionnaire, onUnreadable });
    expect(onUnreadable).not.toHaveBeenCalled();
  });

  it("erro do banco ou formato inesperado: lança só o código (a tela mostra sem medalha), sem a mensagem", async () => {
    const denied = fakeClient({ error: { code: "42501", message: "detalhe interno de Maria" } });
    await expect(readMemberTotems(denied.client, [A], { crypto: crypto({}), questionnaire })).rejects.toThrow("member_totems_failed:42501");
    const odd = fakeClient({ data: [{ profile_id: A }] });
    await expect(readMemberTotems(odd.client, [A], { crypto: crypto({}), questionnaire })).rejects.toThrow("member_totems_failed:shape");
    await expect(readMemberTotems(denied.client, [A], { crypto: crypto({}), questionnaire })).rejects.not.toThrow(/Maria/);
  });

  it("mais de 200 pessoas: várias chamadas de até 200 (teto da função)", async () => {
    const ids = Array.from({ length: 401 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const { client, calls } = fakeClient({ data: [] });
    await readMemberTotems(client, ids, { crypto: crypto({}), questionnaire });
    expect(calls.map((c) => (c.args.p_profiles as string[]).length)).toEqual([memberTotemsBatch, memberTotemsBatch, 1]);
    expect(memberTotemsBatch).toBe(200);
  });
});
