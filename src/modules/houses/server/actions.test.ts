import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseClient } from "../types";

// As actions de aceite do termo e da casa registram no log o MOTIVO TÉCNICO da recusa (#313): código do
// Postgres e status do PostgREST. Nunca a mensagem do banco, as respostas nem dado pessoal. No staging o
// aceite falhou para todos e o log só dizia `reason: failed`.
const warn = vi.fn();
let client: HouseClient | null = null;

vi.mock("@/server/log", () => ({ log: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() } }));
vi.mock("@/server/auth/session", () => ({
  requireUserBeforeHouse: vi.fn(async () => undefined),
  requireUserClientBeforeHouse: vi.fn(async () => ({ user: { id: "u-1" } })),
}));
vi.mock("@/server/crypto", () => ({ decryptField: vi.fn(), encryptField: vi.fn(), signQuestionnaireMessage: vi.fn() }));
vi.mock("./session", () => ({ sessionHouseClient: vi.fn(async () => client) }));
vi.mock("./questionnaire", () => ({ getQuestionnaire: () => ({ consentTermVersion: "termo-1" }) }));

const { acceptHouseAction, recordConsentAction } = await import("./actions");
const { instance } = await import("@config/instance");

function clientFailing(error: unknown, status: number): HouseClient {
  const query = { then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error, status }).then(ok) };
  return {
    rpc: () => Promise.resolve({ data: null, error, status }),
    from: () => ({ select: () => query as never }),
  };
}

beforeEach(() => {
  warn.mockClear();
  client = null;
});

describe("log do aceite recusado (#313)", () => {
  it("recordConsentAction: loga o motivo e também o código do Postgres e o status, sem a mensagem", async () => {
    client = clientFailing({ code: "22023", message: "termo desconhecido de Maria 11 99999-8888" }, 400);
    expect(await recordConsentAction({ termVersion: "termo-1" })).toEqual({ ok: false, error: "failed" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("questionnaire_consent_refused", { reason: "failed", pg_code: "22023", status: 400 });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Maria|99999/);
  });

  it("acceptHouseAction: idem, com o motivo traduzido e o código técnico", async () => {
    client = clientFailing({ code: "C7603", message: "detalhe interno" }, 400);
    const houseId = instance.houses[0]!.id;
    expect(await acceptHouseAction({ houseId, joinMethod: "self" })).toEqual({ ok: false, error: "house_locked" });
    expect(warn).toHaveBeenCalledWith("house_accept_refused", { reason: "house_locked", pg_code: "C7603", status: 400 });
  });

  it("erro do PostgREST sem código de Postgres: loga o status", async () => {
    client = clientFailing({ message: "x" }, 404);
    await recordConsentAction({ termVersion: "termo-1" });
    expect(warn).toHaveBeenCalledWith("questionnaire_consent_refused", { reason: "failed", status: 404 });
  });

  it("entrada inválida (nada foi ao banco): só o motivo, sem código técnico inventado", async () => {
    client = clientFailing({ code: "22023" }, 400);
    await recordConsentAction({ termVersion: "termo-1", extra: 1 });
    expect(warn).toHaveBeenCalledWith("questionnaire_consent_refused", { reason: "failed" });
  });

  it("sucesso não registra recusa", async () => {
    client = { rpc: () => Promise.resolve({ data: "ok", error: null, status: 200 }), from: () => ({ select: () => ({}) as never }) };
    expect(await recordConsentAction({ termVersion: "termo-1" })).toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });
});
