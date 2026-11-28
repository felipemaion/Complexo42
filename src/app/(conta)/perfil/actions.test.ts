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
  backgroundSentField: "backgroundSent",
  neighborhoodSentField: "neighborhoodSent",
  socialLinksSentField: "socialLinksSent",
}));
vi.mock("@/server/auth/session", () => ({
  requireUserClient: async () => ({ user: { id: "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93" }, client: {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { saveProfileAction } = await import("./actions");

const fields = { displayName: "Maria Aparecida", whatsapp: "(11) 98765-4321", stateCode: "SP", municipalityCode: "3550308", district: "", neighborhood: "Vila Exemplo" };
const values = { ...fields, socialLinks: [], educationLevel: "", educationDetail: "", occupation: "" };
function formData() {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.set("neighborhoodSent", "1");
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

  it("bairro (#179): sem o campo escondido, o serviço recebe `undefined` (mantém o guardado)", async () => {
    saveOwnProfile.mockResolvedValue({ status: "failed" });
    const data = formData();
    data.delete("neighborhoodSent");
    await saveProfileAction({ status: "idle" }, data);
    expect(saveOwnProfile.mock.calls[0]![2]).toMatchObject({ neighborhood: undefined });
  });

  it("bairro (#179): com o campo escondido, o texto digitado vai ao serviço, mesmo vazio (apagar é escolha)", async () => {
    saveOwnProfile.mockResolvedValue({ status: "failed" });
    const data = formData();
    data.set("neighborhood", "");
    await saveProfileAction({ status: "idle" }, data);
    expect(saveOwnProfile.mock.calls[0]![2]).toMatchObject({ neighborhood: "" });
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

  it("formação e atividade (#304): sem o campo escondido, o serviço recebe `undefined` (não mexe no guardado)", async () => {
    saveOwnProfile.mockResolvedValue({ status: "failed" });
    const data = formData();
    data.set("educationLevel", "postgraduate");
    data.set("occupation", "Enfermeira");
    await saveProfileAction({ status: "idle" }, data);
    expect(saveOwnProfile.mock.calls[0]![2]).toMatchObject({ educationLevel: undefined, educationDetail: undefined, occupation: undefined });
  });

  it("formação e atividade (#304): com o campo escondido, o que foi digitado vai ao serviço, mesmo vazio", async () => {
    saveOwnProfile.mockResolvedValue({ status: "failed" });
    const data = formData();
    data.set("backgroundSent", "1");
    data.set("educationLevel", "postgraduate");
    data.set("educationDetail", "Saúde Pública");
    data.set("occupation", "");
    expect(await saveProfileAction({ status: "idle" }, data)).toMatchObject({
      status: "failed",
      values: { educationLevel: "postgraduate", educationDetail: "Saúde Pública", occupation: "" },
    });
    expect(saveOwnProfile.mock.calls[0]![2]).toMatchObject({ educationLevel: "postgraduate", educationDetail: "Saúde Pública", occupation: "" });
  });

  it("salvo: segue para a página inicial", async () => {
    saveOwnProfile.mockResolvedValue({ status: "saved" });
    await expect(saveProfileAction({ status: "idle" }, formData())).rejects.toThrow("redirect:/inicio?salvo=1");
  });
});
