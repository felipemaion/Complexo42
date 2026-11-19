// Aceite do termo (#11): a caixa é conferida no servidor e a versão vem da config (nunca do
// navegador). Quem ainda não tem perfil aceita do mesmo jeito: o aceite fica na conta.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentTerm } from "@config/consent";
import type { AcceptConsentResult } from "@/modules/privacy";

const acceptConsent = vi.fn<(...args: unknown[]) => Promise<AcceptConsentResult>>();
const client = { rpc: vi.fn() };
vi.mock("@/modules/privacy", async (original) => ({
  ...(await original<typeof import("@/modules/privacy")>()),
  acceptConsent: (...args: unknown[]) => acceptConsent(...args),
}));
vi.mock("@/server/auth/session", () => ({ requireAccessUserClient: async () => ({ user: { id: "u" }, client }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { acceptConsentAction } = await import("./actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => acceptConsent.mockReset());

describe("acceptConsentAction", () => {
  it("caixa desmarcada → unchecked, sem gravar nada", async () => {
    expect(await acceptConsentAction({ status: "idle" }, form({}))).toEqual({ status: "unchecked" });
    expect(acceptConsent).not.toHaveBeenCalled();
  });

  it("caixa marcada → grava a versão da config (não a do navegador) e vai para a página inicial", async () => {
    acceptConsent.mockResolvedValue({ status: "accepted" });
    await expect(acceptConsentAction({ status: "idle" }, form({ accepted: "on", version: "v999" }))).rejects.toThrow(
      "redirect:/inicio",
    );
    expect(acceptConsent).toHaveBeenCalledWith(client, consentTerm.version);
  });

  it("erro ao gravar → failed, sem seguir adiante", async () => {
    acceptConsent.mockResolvedValue({ status: "failed" });
    expect(await acceptConsentAction({ status: "idle" }, form({ accepted: "on" }))).toEqual({ status: "failed" });
  });
});
