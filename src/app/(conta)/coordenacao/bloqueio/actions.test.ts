// Server action do bloqueio (#26): "Continuar" só abre a confirmação, sem chamar o banco; só
// "Sim" chama `block_member`/`unblock_member` com o JWT de quem está logado; a resposta é neutra
// e o e-mail nunca vai para o log.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rpc = { fn: string; args: Record<string, unknown> };
const calls: Rpc[] = [];
let answer: { data: unknown; error: unknown } = { data: null, error: null };
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

const { memberBlockAction } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  calls.length = 0;
  logged.length = 0;
  answer = { data: null, error: null };
});

describe("memberBlockAction", () => {
  it("continuar: abre a confirmação sem chamar o banco", async () => {
    const state = await memberBlockAction({ status: "idle" }, form({ email: " Pessoa@Exemplo.org", acao: "bloquear", motivo: "conduct", etapa: "preparar" }));
    expect(state).toEqual({ status: "confirm", request: { email: "pessoa@exemplo.org", action: "block", reason: "conduct" } });
    expect(calls).toEqual([]);
  });

  it("sim, bloquear: chama block_member e devolve o resultado neutro", async () => {
    const state = await memberBlockAction({ status: "idle" }, form({ email: "pessoa@exemplo.org", acao: "bloquear", motivo: "", etapa: "confirmar" }));
    expect(state).toEqual({ status: "done", action: "block" });
    expect(calls).toEqual([{ fn: "block_member", args: { p_email: "pessoa@exemplo.org", p_reason: null } }]);
  });

  it("sim, desbloquear: chama unblock_member", async () => {
    const state = await memberBlockAction({ status: "idle" }, form({ email: "pessoa@exemplo.org", acao: "desbloquear", etapa: "confirmar" }));
    expect(state).toEqual({ status: "done", action: "unblock" });
    expect(calls).toEqual([{ fn: "unblock_member", args: { p_email: "pessoa@exemplo.org" } }]);
  });

  it("não, voltar: volta ao início sem chamar o banco", async () => {
    const state = await memberBlockAction({ status: "idle" }, form({ email: "pessoa@exemplo.org", acao: "bloquear", etapa: "cancelar" }));
    expect(state).toEqual({ status: "idle" });
    expect(calls).toEqual([]);
  });

  it("entrada inválida: erro, sem chamar o banco", async () => {
    expect(await memberBlockAction({ status: "idle" }, form({ email: "sem-arroba", acao: "bloquear", etapa: "confirmar" }))).toEqual({
      status: "error",
      error: "invalid_email",
    });
    expect(await memberBlockAction({ status: "idle" }, form({ email: "pessoa@exemplo.org", acao: "bloquear", motivo: "x", etapa: "confirmar" }))).toEqual({
      status: "error",
      error: "invalid_reason",
    });
    expect(calls).toEqual([]);
  });

  it("recusa do banco (sem papel de gestor): forbidden, sem log", async () => {
    answer = { data: null, error: { code: "42501", message: "só a coordenação" } };
    const state = await memberBlockAction({ status: "idle" }, form({ email: "pessoa@exemplo.org", acao: "bloquear", etapa: "confirmar" }));
    expect(state).toEqual({ status: "error", error: "forbidden" });
    expect(logged).toEqual([]);
  });

  it("limite de tentativas (54000): rate_limited, sem log", async () => {
    answer = { data: null, error: { code: "54000", message: "too_many_attempts" } };
    const state = await memberBlockAction({ status: "idle" }, form({ email: "pessoa@exemplo.org", acao: "bloquear", etapa: "confirmar" }));
    expect(state).toEqual({ status: "error", error: "rate_limited" });
    expect(logged).toEqual([]);
  });

  it("outra falha: failed, com só o código no log (nunca o e-mail)", async () => {
    answer = { data: null, error: { code: "57014", message: "detalhe interno" } };
    const state = await memberBlockAction({ status: "idle" }, form({ email: "pessoa@exemplo.org", acao: "bloquear", etapa: "confirmar" }));
    expect(state).toEqual({ status: "error", error: "failed" });
    expect(logged).toEqual([["member_block_failed", { reason: "db_error" }]]);
  });
});
