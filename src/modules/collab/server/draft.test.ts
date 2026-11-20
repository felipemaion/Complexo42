import { describe, expect, it } from "vitest";
import type { CollabClient } from "../types";
import { openDraft, pickInDraft, readDraftState, requestEvaluationAccess } from "./draft";

type Call = { fn: string; args?: Record<string, unknown> };

function fakeClient(result: { data?: unknown; error?: unknown } = {}): { client: CollabClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return { data: result.data ?? null, error: result.error ?? null };
      },
    },
  };
}

const id = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`;

describe("draft", () => {
  it("abrir com menos de 2 equipes é recusado sem chamar o banco", async () => {
    // Arrange
    const { client, calls } = fakeClient();

    // Act
    const result = await openDraft(client, { parentId: id(1), teamIds: [id(2)], sliceSize: "3" });

    // Assert
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("abrir manda a ordem das equipes e o tamanho do trecho como número", async () => {
    const { client, calls } = fakeClient();

    await openDraft(client, { parentId: id(1), teamIds: [id(2), id(3)], sliceSize: "5" });

    expect(calls[0]).toEqual({ fn: "open_draft", args: { p_parent: id(1), p_team_order: [id(2), id(3)], p_slice_size: 5 } });
  });

  it("escolher fora da vez (42501) vira 'not_allowed'", async () => {
    const { client } = fakeClient({ error: { code: "42501" } });

    expect(await pickInDraft(client, { sessionId: id(1), profileId: id(2) })).toEqual({ ok: false, error: "not_allowed" });
  });

  it("sem rodada aberta, o estado é nulo", async () => {
    const { client } = fakeClient({ data: [] });

    expect(await readDraftState(client)).toBeNull();
  });
});

describe("pedido de acesso à avaliação", () => {
  it("motivo curto é recusado sem chamar o banco", async () => {
    const { client, calls } = fakeClient();

    const result = await requestEvaluationAccess(client, { profileId: id(1), reason: "curto" }, async (v) => v);

    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("decifra a nota e o comentário devolvidos", async () => {
    const { client } = fakeClient({ data: [{ axis: "team", grade_enc: "c1", note_enc: null, cycle_ends_on: "2026-11-20" }] });

    const result = await requestEvaluationAccess(client, { profileId: id(1), reason: "Indicação para o debate" }, async () => "ouro");

    expect(result).toEqual({ ok: true, value: [{ axis: "team", grade: "ouro", note: null, cycleEndsOn: "2026-11-20" }] });
  });
});
