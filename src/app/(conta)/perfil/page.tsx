import type { Metadata } from "next";
import { instance } from "@config/instance";
import { states } from "@config/states";
import { formatBrazilianWhatsapp, listDistricts, listMunicipalitiesByState, loadOwnProfile, needsFullNameNotice, ProfileForm } from "@/modules/profiles";
import { usesGoogleSignIn } from "@/server/auth/password-flows";
import { requireUserClient } from "@/server/auth/session";
import { setPasswordAction } from "../senha/actions";
import { PasswordForm } from "../senha/password-form";
import { saveProfileAction } from "./actions";
import { loadDistrictsAction, loadMunicipalitiesAction } from "./localities-actions";

export const metadata: Metadata = { title: instance.profile.title };

// Formulário do perfil (#12): criar ou mudar nome, WhatsApp e localização. O texto da própria
// pessoa só é decifrado aqui, no servidor, para preencher os campos.
export default async function ProfilePage() {
  const { user, client } = await requireUserClient();
  const own = await loadOwnProfile(client, user.id);
  // Quem já tem perfil abre o formulário com as listas da própria cidade; quem começa, vazias.
  const [initialMunicipalities, initialDistricts] = own
    ? await Promise.all([listMunicipalitiesByState(client, own.stateCode), listDistricts(client, own.municipalityCode)])
    : [[], []];
  const text = instance.profile;
  // Senha opcional (ADR 0018): só para quem não entra pelo Google; a troca e a remoção ficam em /senha.
  const { data: authUser } = await client.auth.getUser();
  const offerPassword = !usesGoogleSignIn(authUser.user);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      {own && needsFullNameNotice(own.displayName) && (
        <p role="status" className="rounded-lg border-2 border-current p-4 text-lg">
          {text.completeNameNotice}
        </p>
      )}
      <ProfileForm
        action={saveProfileAction}
        initial={{
          displayName: own?.displayName ?? "",
          whatsapp: own ? formatBrazilianWhatsapp(own.whatsapp) : "",
          stateCode: own?.stateCode ?? "",
          municipalityCode: own ? String(own.municipalityCode) : "",
          district: own?.districtCode === null || own === null ? "" : String(own.districtCode),
          // Os links salvos voltam para as caixas: salvar sem mexer neles os mantém (#17).
          neighborhood: own?.neighborhood ?? "",
          socialLinks: own?.socialLinks ?? [],
          educationLevel: own?.educationLevel ?? "",
          educationDetail: own?.educationDetail ?? "",
          occupation: own?.occupation ?? "",
        }}
        states={states}
        initialMunicipalities={initialMunicipalities}
        initialDistricts={initialDistricts}
        loadMunicipalities={loadMunicipalitiesAction}
        loadDistricts={loadDistrictsAction}
        neighborhoodUnreadable={own?.neighborhoodUnreadable ?? false}
        socialLinksUnreadable={own?.socialLinksUnreadable ?? false}
        text={text}
      />
      {offerPassword && (
        <section aria-labelledby="criar-senha" className="flex flex-col gap-3 border-t border-neutral-300 pt-6">
          <h2 id="criar-senha" className="text-2xl font-semibold">
            {instance.password.sectionTitle}
          </h2>
          <PasswordForm saveAction={setPasswordAction} text={instance.password} idPrefix="perfil-senha" />
        </section>
      )}
    </main>
  );
}
