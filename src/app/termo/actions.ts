"use server";
// Aceite do termo (#11). O navegador manda só a caixa marcada; a versão do termo vem do
// config/consent.ts e o banco só aceita a vigente. Nada de dado pessoal em log (R11).
import { redirect } from "next/navigation";
import { consentTerm } from "@config/consent";
import { acceptConsent, consentFormSchema, type ConsentFormState } from "@/modules/privacy";
import { HOME_PATH } from "@/server/auth/routes";
import { requireAccessUserClient } from "@/server/auth/session";

export async function acceptConsentAction(_previous: ConsentFormState, formData: FormData): Promise<ConsentFormState> {
  const { client } = await requireAccessUserClient();
  // Conferido no servidor: o botão desabilitado é só conforto.
  if (!consentFormSchema.safeParse({ accepted: formData.get("accepted") }).success) return { status: "unchecked" };
  const result = await acceptConsent(client, consentTerm.version);
  if (result.status === "failed") return { status: "failed" };
  // A página inicial leva ao formulário de quem ainda não tem perfil.
  redirect(HOME_PATH);
}
