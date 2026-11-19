// Server action do perfil: cada resultado do serviço vira o estado certo do formulário. O foco é o
// limite de WhatsApp repetido (#127): a pessoa recebe `too_many_attempts`, com o que digitou de
// volta, e o texto neutro de config/instance.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instance } from "@config/instance";
import type { SaveProfileResult } from "@/modules/profiles";

const saveOwnProfile = vi.fn<(...args: unknown[]) => Promise<SaveProfileResult>>();
vi.mock("@/modules/profiles", () => ({
  saveOwnProfile: (...args: unknown[]) => saveOwnProfile(...args),
  socialLinkFormEntriesMax: 20,
  socialLinkInputMaxLength: 2048,
  socialLinksSentField: "socialLinksSent",
}));
vi.mock("@/server/auth/session", () => ({
  requireUserClient: async () => ({ user: { id: "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93" }, client: {} }),
}));
const finishPendingConsent = vi.fn(async () => {});
vi.mock("@/server/auth/consent", () => ({ finishPendingConsent: () => finishPendingConsent() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { saveProfileAction } = await import("./actions");

const fields = { displayName: "Maria Aparecida", whatsapp: "(11) 98765-4321", municipalityCode: "3550308", district: "" };
const values = { ...fields, socialLinks: [] };
function formData() {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  saveOwnProfile.mockReset();
  finishPendingConsent.mockClear();
});

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

  it("links (#17): passa as caixas na ordem ao serviço e devolve as posições erradas com o que foi digitado", async () => {
    const data = formData();
    data.set("socialLinksSent", "1");
    data.append("socialLinks", "instagram.com/maria");
    data.append("socialLinks", "javascript:alert(1)");
    saveOwnProfile.mockResolvedValue({ status: "invalid", fields: ["socialLinks"], badLinks: [1] });
    expect(await saveProfileAction({ status: "idle" }, data)).toEqual({
      status: "invalid",
      fields: ["socialLinks"],
      badLinks: [1],
      values: { ...values, socialLinks: ["instagram.com/maria", "javascript:alert(1)"] },
    });
    expect(saveOwnProfile.mock.calls[0]![2]).toMatchObject({ socialLinks: ["instagram.com/maria", "javascript:alert(1)"] });
  });

  it("links (#17): sem o campo escondido, o serviço recebe `undefined` (mantém os guardados)", async () => {
    saveOwnProfile.mockResolvedValue({ status: "failed" });
    await saveProfileAction({ status: "idle" }, formData());
    expect(saveOwnProfile.mock.calls[0]![2]).toMatchObject({ socialLinks: undefined });
  });

  it("links (#17): texto longo demais passa só até 1 caractere acima do limite, para ser recusado", async () => {
    const data = formData();
    data.set("socialLinksSent", "1");
    data.append("socialLinks", `https://rede.example/${"a".repeat(5000)}`);
    saveOwnProfile.mockResolvedValue({ status: "failed" });
    await saveProfileAction({ status: "idle" }, data);
    const sent = (saveOwnProfile.mock.calls[0]![2] as { socialLinks: string[] }).socialLinks;
    expect(sent[0]).toHaveLength(2049);
  });

  it("salvo: segue para a página inicial", async () => {
    saveOwnProfile.mockResolvedValue({ status: "saved" });
    await expect(saveProfileAction({ status: "idle" }, formData())).rejects.toThrow("redirect:/inicio?salvo=1");
  });

  it("salvo: grava o aceite do termo pendente de quem ainda não tinha perfil (#11)", async () => {
    saveOwnProfile.mockResolvedValue({ status: "saved" });
    await expect(saveProfileAction({ status: "idle" }, formData())).rejects.toThrow("redirect:");
    expect(finishPendingConsent).toHaveBeenCalledOnce();
  });

  it("WhatsApp repetido: o aceite pendente não é gravado (o perfil não foi criado)", async () => {
    saveOwnProfile.mockResolvedValue({ status: "duplicate_whatsapp" });
    await saveProfileAction({ status: "idle" }, formData());
    expect(finishPendingConsent).not.toHaveBeenCalled();
  });
});
