import type { Metadata } from "next";
import { districtsByMunicipality } from "@config/districts";
import { instance } from "@config/instance";
import { formatBrazilianWhatsapp, listMunicipalities, loadOwnProfile, ProfileForm } from "@/modules/profiles";
import { requireUserClient } from "@/server/auth/session";
import { saveProfileAction } from "./actions";

export const metadata: Metadata = { title: instance.profile.title };

// Formulário do perfil (#12): criar ou mudar nome, WhatsApp e localização. O texto da própria
// pessoa só é decifrado aqui, no servidor, para preencher os campos.
export default async function ProfilePage() {
  const { user, client } = await requireUserClient();
  const [own, municipalities] = await Promise.all([loadOwnProfile(client, user.id), listMunicipalities(client)]);
  const text = instance.profile;
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      <ProfileForm
        action={saveProfileAction}
        initial={{
          displayName: own?.displayName ?? "",
          whatsapp: own ? formatBrazilianWhatsapp(own.whatsapp) : "",
          municipalityCode: own ? String(own.municipalityCode) : "",
          district: own?.district ?? "",
          // Os links salvos voltam para as caixas: salvar sem mexer neles os mantém (#17).
          socialLinks: own?.socialLinks ?? [],
        }}
        municipalities={municipalities}
        districts={districtsByMunicipality}
        text={text}
      />
    </main>
  );
}
