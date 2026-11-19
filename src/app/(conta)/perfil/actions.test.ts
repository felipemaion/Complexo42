// Server action do perfil: cada resultado do serviço vira o estado certo do formulário. O foco é o
// limite de WhatsApp repetido (#127): a pessoa recebe `too_many_attempts`, com o que digitou de
// volta, e o texto neutro de config/instance.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";
import type { SaveProfileResult } from "@/modules/profiles";

const saveOwnProfile = vi.fn<(...args: unknown[]) => Promise<SaveProfileResult>>();
vi.mock("@/modules/profiles", () => ({ saveOwnProfile: (...args: unknown[]) => saveOwnProfile(...args) }));
vi.mock("@/server/auth/session", () => ({
  requireUserClient: async () => ({ user: { id: "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93" }, client: {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { saveProfileAction } = await import("./actions");

const values = { displayName: "Maria Aparecida", whatsapp: "(11) 98765-4321", municipalityCode: "3550308", district: "" };
function formData() {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => saveOwnProfile.mockReset());

describe("saveProfileAction", () => {
  it("limite de tentativas: estado too_many_attempts, com os valores digitados de volta", async () => {
    saveOwnProfile.mockResolvedValue({ status: "too_many_attempts" });
    expect(await saveProfileAction({ status: "idle" }, formData())).toEqual({ status: "too_many_attempts", values });
  });

  it("o texto do limite é neutro: não fala do número nem de outro cadastro", () => {
    expect(instance.profile.tooManyAttempts).toBe("Muitas tentativas. Tente de novo mais tarde.");
    expect(instance.profile.tooManyAttempts).not.toMatch(/whatsapp|cadastr|número/i);
  });

  it("WhatsApp repetido e falha continuam com os próprios estados", async () => {
    saveOwnProfile.mockResolvedValue({ status: "duplicate_whatsapp" });
    expect(await saveProfileAction({ status: "idle" }, formData())).toEqual({ status: "duplicate_whatsapp", values });
    saveOwnProfile.mockResolvedValue({ status: "failed" });
    expect(await saveProfileAction({ status: "idle" }, formData())).toEqual({ status: "failed", values });
  });

  it("salvo: segue para a página inicial", async () => {
    saveOwnProfile.mockResolvedValue({ status: "saved" });
    await expect(saveProfileAction({ status: "idle" }, formData())).rejects.toThrow("redirect:/inicio?salvo=1");
  });
});
