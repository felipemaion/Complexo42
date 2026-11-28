import type { Metadata } from "next";
import { instance } from "@config/instance";
import { states } from "@config/states";
import { formatBrazilianWhatsapp, listDistricts, listMunicipalitiesByState, hasOwnPhoto, loadOwnProfile, needsFullNameNotice, parsePhotoStatus, PHOTO_STATUS_PARAM, PhotoSection, ProfileForm } from "@/modules/profiles";
import { usesGoogleSignIn } from "@/server/auth/password-flows";
import { requireUserClient } from "@/server/auth/session";
import { setPasswordAction } from "../senha/actions";
import { PasswordForm } from "../senha/password-form";
import { saveProfileAction } from "./actions";
import { loadDistrictsAction, loadMunicipalitiesAction } from "./localities-actions";
import { cardClass, noticeClass, PageShell } from "@/modules/ui";

export const metadata: Metadata = { title: instance.profile.title };

// Formulário do perfil (#12): criar ou mudar nome, WhatsApp e localização. O texto da própria
// pessoa só é decifrado aqui, no servidor, para preencher os campos.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProfilePage({ searchParams }: Props) {
  const { user, client } = await requireUserClient();
  const own = await loadOwnProfile(client, user.id);
  // Quem já tem perfil abre o formulário com as listas da própria cidade; quem começa, vazias.
  const [initialMunicipalities, initialDistricts] = own
    ? await Promise.all([listMunicipalitiesByState(client, own.stateCode), listDistricts(client, own.municipalityCode)])
    : [[], []];
  const text = instance.profile;
  const photoStatus = parsePhotoStatus((await searchParams)[PHOTO_STATUS_PARAM]);
  // Foto (#308): só consulta se a chave estiver ligada (desligada por padrão).
  const hasPhoto = text.photoEnabled && own !== null ? await hasOwnPhoto(client, user.id) : false;
  // Senha opcional (ADR 0018): só para quem não entra pelo Google; a troca e a remoção ficam em /senha.
  const { data: authUser } = await client.auth.getUser();
  const offerPassword = !usesGoogleSignIn(authUser.user);
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      {own && needsFullNameNotice(own.displayName) && (
        <p role="status" className={noticeClass("info")}>
          {text.completeNameNotice}
        </p>
      )}
      <div className={cardClass()}>
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
      </div>
      {own && <PhotoSection enabled={text.photoEnabled} profileId={user.id} hasPhoto={hasPhoto} status={photoStatus} text={text} />}
      {offerPassword && (
        <section aria-labelledby="criar-senha" className={cardClass()}>
          <h2 id="criar-senha" className="text-2xl font-bold">
            {instance.password.sectionTitle}
          </h2>
          <PasswordForm saveAction={setPasswordAction} text={instance.password} idPrefix="perfil-senha" />
        </section>
      )}
    </PageShell>
  );
}
