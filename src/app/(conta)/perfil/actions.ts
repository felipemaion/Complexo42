"use server";
// Server action do formulário do perfil (#12). Só composição: sessão (requireUserClient, com o
// JWT da pessoa) + serviço do módulo de perfis, que valida (Zod), cifra e grava pela função
// `save_own_profile`. Nada de dado da pessoa em log ou na URL (R11).
import { redirect } from "next/navigation";
import { districtsByMunicipality } from "@config/districts";
import { saveOwnProfile, type ProfileFormState, type ProfileFormValues } from "@/modules/profiles";
import { HOME_PATH } from "@/server/auth/routes";
import { requireUserClient } from "@/server/auth/session";

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.slice(0, 200) : "");

export async function saveProfileAction(_previous: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const { user, client } = await requireUserClient();
  const values: ProfileFormValues = {
    displayName: text(formData.get("displayName")),
    whatsapp: text(formData.get("whatsapp")),
    municipalityCode: text(formData.get("municipalityCode")),
    district: text(formData.get("district")),
  };
  const result = await saveOwnProfile(client, user.id, values, (code) => districtsByMunicipality[code]);
  switch (result.status) {
    case "saved":
      // A página inicial passa de novo pelo portão de acesso (perfil novo nasce `pending`).
      redirect(`${HOME_PATH}?salvo=1`);
    case "invalid":
      return { status: "invalid", fields: result.fields, values };
    case "duplicate_whatsapp":
      return { status: "duplicate_whatsapp", values };
    case "forbidden":
      // Bloqueado ou suspenso: requireUser já encerra a sessão de quem está bloqueado.
      redirect(HOME_PATH);
    case "failed":
      return { status: "failed", values };
  }
}
