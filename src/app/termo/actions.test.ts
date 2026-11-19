// Aceite do termo (#11): a caixa é conferida no servidor, a versão vem da config (nunca do
// navegador) e quem ainda não tem perfil fica com o aceite pendente.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentTerm } from "@config/consent";
import type { AcceptConsentResult } from "@/modules/privacy";

const acceptConsent = vi.fn<(...args: unknown[]) => Promise<AcceptConsentResult>>();
const setPendingConsent = vi.fn<(secure: boolean) => Promise<void>>(async () => {});
const client = { rpc: vi.fn() };
vi.mock("@/modules/privacy", async (original) => ({
  ...(await original<typeof import("@/modules/privacy")>()),
  acceptConsent: (...args: unknown[]) => acceptConsent(...args),
}));
vi.mock("@/server/auth/session", () => ({ requireAccessUserClient: async () => ({ user: { id: "u" }, client }) }));
vi.mock("@/server/auth/consent", () => ({ setPendingConsent: (secure: boolean) => setPendingConsent(secure) }));
vi.mock("@/server/auth/config", () => ({ getAuthConfig: () => ({ siteUrl: "http://127.0.0.1:3000" }) }));
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

beforeEach(() => {
  acceptConsent.mockReset();
  setPendingConsent.mockClear();
});

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
    expect(setPendingConsent).not.toHaveBeenCalled();
  });

  it("sem perfil ainda → guarda o aceite pendente e segue", async () => {
    acceptConsent.mockResolvedValue({ status: "no_profile" });
    await expect(acceptConsentAction({ status: "idle" }, form({ accepted: "on" }))).rejects.toThrow("redirect:/inicio");
    expect(setPendingConsent).toHaveBeenCalledWith(false);
  });

  it("erro ao gravar → failed, sem seguir adiante", async () => {
    acceptConsent.mockResolvedValue({ status: "failed" });
    expect(await acceptConsentAction({ status: "idle" }, form({ accepted: "on" }))).toEqual({ status: "failed" });
    expect(setPendingConsent).not.toHaveBeenCalled();
  });
});
