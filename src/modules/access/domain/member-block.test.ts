import { describe, expect, it } from "vitest";
import { parseMemberBlockRequest, parseMemberBlockStep, wordOf } from "./member-block";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseMemberBlockRequest", () => {
  it("bloquear com motivo: e-mail normalizado e motivo da lista", () => {
    expect(parseMemberBlockRequest(form({ acao: "bloquear", email: "  Pessoa@Exemplo.ORG ", motivo: "impersonation" }))).toEqual({
      ok: true,
      request: { email: "pessoa@exemplo.org", action: "block", reason: "impersonation" },
    });
  });

  it("bloquear sem motivo: o motivo é opcional", () => {
    expect(parseMemberBlockRequest(form({ acao: "bloquear", email: "pessoa@exemplo.org", motivo: "" }))).toEqual({
      ok: true,
      request: { email: "pessoa@exemplo.org", action: "block", reason: null },
    });
  });

  it("desbloquear ignora o motivo", () => {
    expect(parseMemberBlockRequest(form({ acao: "desbloquear", email: "pessoa@exemplo.org", motivo: "conduct" }))).toEqual({
      ok: true,
      request: { email: "pessoa@exemplo.org", action: "unblock", reason: null },
    });
  });

  it("motivo fora da lista fechada → invalid_reason (nada de texto livre)", () => {
    expect(parseMemberBlockRequest(form({ acao: "bloquear", email: "pessoa@exemplo.org", motivo: "texto livre" }))).toEqual({
      ok: false,
      error: "invalid_reason",
    });
  });

  it("e-mail inválido ou ausente → invalid_email", () => {
    expect(parseMemberBlockRequest(form({ acao: "bloquear", email: "sem-arroba" }))).toEqual({ ok: false, error: "invalid_email" });
    expect(parseMemberBlockRequest(form({ acao: "bloquear" }))).toEqual({ ok: false, error: "invalid_email" });
  });

  it("ação desconhecida → invalid_action", () => {
    expect(parseMemberBlockRequest(form({ acao: "apagar", email: "pessoa@exemplo.org" }))).toEqual({ ok: false, error: "invalid_action" });
  });
});

describe("parseMemberBlockStep", () => {
  it("só confirma com o botão de confirmar; qualquer outro valor só prepara", () => {
    expect(parseMemberBlockStep("confirmar")).toBe("confirmar");
    expect(parseMemberBlockStep("cancelar")).toBe("cancelar");
    expect(parseMemberBlockStep("executar")).toBe("preparar");
    expect(parseMemberBlockStep(null)).toBe("preparar");
  });
});

describe("wordOf", () => {
  it("devolve a palavra do formulário", () => {
    expect(wordOf("block")).toBe("bloquear");
    expect(wordOf("unblock")).toBe("desbloquear");
  });
});
