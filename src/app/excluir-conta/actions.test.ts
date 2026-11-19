// Server actions do "Excluir minha conta" (#18): cada resultado do serviço vira o destino certo,
// a sessão só é encerrada depois da exclusão (ou para entrar de novo) e a URL não leva nada
// da pessoa. O serviço (palavra, PT401, log sem dado pessoal) é testado no módulo de privacidade.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";
import { CONFIRMATION_WORD, type DeleteOwnAccountResult } from "@/modules/privacy";

const deleteOwnAccount = vi.fn<(...args: unknown[]) => Promise<DeleteOwnAccountResult>>();
const endSession = vi.fn(async () => {});
const client = { rpc: vi.fn() };
vi.mock("@/modules/privacy", async (original) => ({
  ...(await original<typeof import("@/modules/privacy")>()),
  deleteOwnAccount: (...args: unknown[]) => deleteOwnAccount(...args),
}));
vi.mock("@/server/auth/session", () => ({
  requireSessionClient: async () => ({ client, accessToken: "token" }),
  endSession: () => endSession(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { deleteAccountAction, reauthenticateAction } = await import("./actions");

function form(confirmation: string) {
  const data = new FormData();
  data.set("confirmation", confirmation);
  return data;
}

beforeEach(() => {
  deleteOwnAccount.mockReset();
  endSession.mockClear();
});

describe("deleteAccountAction", () => {
  it("excluída: passa a palavra digitada ao serviço com o cliente da sessão, encerra a sessão e se despede", async () => {
    deleteOwnAccount.mockResolvedValue({ status: "deleted" });
    await expect(deleteAccountAction(form("excluir"))).rejects.toThrow("redirect:/conta-excluida");
    expect(deleteOwnAccount).toHaveBeenCalledWith(client, { confirmation: "excluir" });
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("login antigo: volta pedindo para entrar de novo, sem encerrar a sessão", async () => {
    deleteOwnAccount.mockResolvedValue({ status: "reauth_required" });
    await expect(deleteAccountAction(form("EXCLUIR"))).rejects.toThrow("redirect:/excluir-conta?erro=reautenticar");
    expect(endSession).not.toHaveBeenCalled();
  });

  it("palavra errada e falha: voltam com o motivo, sem encerrar a sessão nem repetir o que foi digitado", async () => {
    deleteOwnAccount.mockResolvedValue({ status: "invalid_confirmation" });
    await expect(deleteAccountAction(form("talvez"))).rejects.toThrow(/^redirect:\/excluir-conta\?erro=confirmacao$/);
    deleteOwnAccount.mockResolvedValue({ status: "failed" });
    await expect(deleteAccountAction(form("EXCLUIR"))).rejects.toThrow(/^redirect:\/excluir-conta\?erro=falhou$/);
    expect(endSession).not.toHaveBeenCalled();
  });
});

describe("reauthenticateAction", () => {
  it("sai e vai ao login, que volta para a exclusão", async () => {
    await expect(reauthenticateAction()).rejects.toThrow("redirect:/entrar?next=%2Fexcluir-conta");
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("se encerrar a sessão falhar, vai ao login do mesmo jeito", async () => {
    endSession.mockRejectedValueOnce(new Error("gotrue_down"));
    await expect(reauthenticateAction()).rejects.toThrow("redirect:/entrar?next=%2Fexcluir-conta");
  });
});

describe("deleteAccountAction com falha ao encerrar a sessão", () => {
  it("a conta já foi excluída: a despedida aparece mesmo se o logout falhar", async () => {
    deleteOwnAccount.mockResolvedValue({ status: "deleted" });
    endSession.mockRejectedValueOnce(new Error("gotrue_down"));
    await expect(deleteAccountAction(form("EXCLUIR"))).rejects.toThrow("redirect:/conta-excluida");
  });
});

describe("textos", () => {
  it("os textos que citam a palavra usam a mesma do servidor", () => {
    expect(instance.deleteAccount.confirmLabel).toContain(CONFIRMATION_WORD);
    expect(instance.deleteAccount.invalidConfirmation).toContain(CONFIRMATION_WORD);
  });
});
