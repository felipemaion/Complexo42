// Server action de "Liberar" / "Bloquear" (#26): a decisão vai para `decide_access` com o
// JWT de quem está logado; a recusa do banco (42501) vira uma mensagem neutra, sem oráculo.
import { beforeEach, describe, expect, it, vi } from "vitest";

const PERSON = "6a1d7c2e-5b4f-4e3a-9c8d-1f2e3a4b5c6d";
type Rpc = { fn: string; args: Record<string, unknown> };
const calls: Rpc[] = [];
let answer: { data: unknown; error: unknown } = { data: "active", error: null };
const client = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return answer;
  },
};
const logged: unknown[] = [];

vi.mock("@/server/auth/session", () => ({
  requireUserClient: async () => ({ user: { id: "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93" }, client }),
}));
vi.mock("@/server/log", () => ({ log: { info: () => {}, warn: () => {}, error: (...a: unknown[]) => logged.push(a) } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { decideAccessAction } = await import("./actions");

function form(person: string, decision: string): FormData {
  const data = new FormData();
  data.set("pessoa", person);
  data.set("decisao", decision);
  return data;
}

beforeEach(() => {
  calls.length = 0;
  logged.length = 0;
});

describe("decideAccessAction", () => {
  it("liberar: decide_access com active e volta à fila com a confirmação", async () => {
    answer = { data: "active", error: null };
    await expect(decideAccessAction(form(PERSON, "liberar"))).rejects.toThrow("redirect:/coordenacao/espera?feito=liberado");
    expect(calls).toEqual([{ fn: "decide_access", args: { p_profile: PERSON, p_decision: "active" } }]);
  });

  it("bloquear: decide_access com blocked", async () => {
    answer = { data: "blocked", error: null };
    await expect(decideAccessAction(form(PERSON, "bloquear"))).rejects.toThrow("redirect:/coordenacao/espera?feito=bloqueado");
    expect(calls).toEqual([{ fn: "decide_access", args: { p_profile: PERSON, p_decision: "blocked" } }]);
  });

  it("recusa do banco (fora do escopo ou já decidida): indisponivel, sem log", async () => {
    answer = { data: null, error: { code: "42501", message: "sem permissão" } };
    await expect(decideAccessAction(form(PERSON, "liberar"))).rejects.toThrow("redirect:/coordenacao/espera?feito=indisponivel");
    expect(logged).toEqual([]);
  });

  it("outra falha: erro, com só o código no log", async () => {
    answer = { data: null, error: { code: "57014", message: "detalhe interno" } };
    await expect(decideAccessAction(form(PERSON, "bloquear"))).rejects.toThrow("redirect:/coordenacao/espera?feito=erro");
    expect(logged).toEqual([["access_decision_failed", { reason: "db_error" }]]);
  });

  it("id que não é uuid ou decisão desconhecida: erro, sem chamar o banco", async () => {
    for (const [person, decision] of [
      ["1 or 1=1", "liberar"],
      [PERSON, "active"],
      [PERSON, "pending"],
      [PERSON, ""],
    ] as const) {
      await expect(decideAccessAction(form(person, decision))).rejects.toThrow("redirect:/coordenacao/espera?feito=erro");
    }
    expect(calls).toEqual([]);
  });
});
