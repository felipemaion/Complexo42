"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { StateOption } from "@config/states";
import { socialLinksSentField, type ProfileFormField } from "../domain/form";
import { profileLimits } from "../domain/schema";
import { formatBrazilianWhatsapp, whatsappInputMaxLength } from "../domain/whatsapp";
import type { DistrictOption, MunicipalityOption, ProfileFormState, ProfileFormValues } from "../types";
import { LocationFields, type LocationText } from "./location-fields";

// Formulário do perfil (issue #12). Só apresentação e eventos: quem valida, cifra e grava é a
// server action (no servidor). Mobile-first, botões e letras grandes, tudo à vista e em
// linguagem simples (pedido do stakeholder; o público inclui pessoas mais velhas).

export type ProfileFormText = LocationText & {
  neighborhoodLabel: string;
  neighborhoodHint: string;
  intro: string;
  nameLabel: string;
  nameHint: string;
  whatsappLabel: string;
  whatsappHint: string;
  /** Redes sociais (#17): título do grupo, dica, rótulo de cada caixa ("Link 1"...) e botões. */
  socialLinksLabel: string;
  socialLinksHint: string;
  socialLinkLabel: string;
  addSocialLink: string;
  removeSocialLink: string;
  /** Links guardados que não abriram: aviso de que continuam guardados, e o botão para trocá-los. */
  socialLinksUnreadable: string;
  replaceSocialLinks: string;
  saveButton: string;
  saving: string;
  errorSummary: string;
  fieldErrors: Record<ProfileFormField, string>;
  duplicateWhatsapp: string;
  /** Limite de tentativas com WhatsApp repetido (#127): neutro, não diz nada do número. */
  tooManyAttempts: string;
  failed: string;
};

type Props = {
  action: (state: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
  initial: ProfileFormValues;
  states: readonly StateOption[];
  /** Cidades da UF e distritos da cidade já salvas (vazias para quem começa agora). */
  initialMunicipalities: readonly MunicipalityOption[];
  initialDistricts: readonly DistrictOption[];
  /** Server actions de leitura da referência: as cidades vêm por UF, os distritos por cidade. */
  loadMunicipalities: (stateCode: string) => Promise<MunicipalityOption[]>;
  loadDistricts: (municipalityCode: number) => Promise<DistrictOption[]>;
  /**
   * Os links guardados não abriram inteiros (#17): sem caixas nem o campo escondido, para o
   * servidor manter o valor cifrado, até a pessoa tocar em "trocar".
   */
  socialLinksUnreadable?: boolean;
  text: ProfileFormText;
};

const inputClass =
  "w-full rounded-xl border-2 border-neutral-500 bg-transparent px-4 py-4 text-xl aria-[invalid=true]:border-red-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";
const fieldOrder: readonly ProfileFormField[] = ["displayName", "whatsapp", "municipalityCode", "district", "neighborhood", "socialLinks"];
const fieldId: Record<ProfileFormField, string> = {
  displayName: "perfil-nome",
  whatsapp: "perfil-whatsapp",
  municipalityCode: "perfil-cidade",
  district: "perfil-distrito",
  neighborhood: "perfil-bairro",
  socialLinks: "perfil-redes",
};
const linkId = (index: number) => `perfil-rede-${index + 1}`;
const buttonClass =
  "block w-full rounded-xl border-2 border-current px-6 py-4 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

export function ProfileForm({
  action,
  initial,
  states,
  initialMunicipalities,
  initialDistricts,
  loadMunicipalities,
  loadDistricts,
  socialLinksUnreadable = false,
  text,
}: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ProfileFormState);
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const summaryRef = useRef<HTMLDivElement>(null);
  const addLinkRef = useRef<HTMLButtonElement>(null);
  // Para onde vai o foco depois de pôr ou tirar um link: a caixa nova, ou o botão de acrescentar.
  const [editingLinks, setEditingLinks] = useState(!socialLinksUnreadable);
  const [linkFocus, setLinkFocus] = useState<{ target: number | "add" } | null>(null);

  // Depois de cada resposta com erro: volta o que a pessoa digitou e leva o foco para o resumo.
  // (Ajuste durante o render: é o padrão do React para estado derivado de uma resposta.)
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    if (state.status !== "idle") setValues(state.values);
  }
  useEffect(() => {
    if (state.status !== "idle") summaryRef.current?.focus();
  }, [state]);
  useEffect(() => {
    if (linkFocus === null) return;
    if (linkFocus.target === "add") addLinkRef.current?.focus();
    else document.getElementById(linkId(linkFocus.target))?.focus();
  }, [linkFocus]);

  const invalid = new Set<ProfileFormField>(state.status === "invalid" ? state.fields : []);
  if (state.status === "duplicate_whatsapp") invalid.add("whatsapp");
  const badLinks = new Set(state.status === "invalid" ? (state.badLinks ?? []) : []);
  // Sem links salvos, uma caixa vazia já aparece (funciona até sem JavaScript).
  const linkRows = values.socialLinks.length > 0 ? values.socialLinks : [""];
  const setLink = (index: number, value: string) =>
    setValues((current) => {
      const next = current.socialLinks.length > 0 ? [...current.socialLinks] : [""];
      next[index] = value;
      return { ...current, socialLinks: next };
    });
  const addLink = () => {
    setValues((current) => ({ ...current, socialLinks: [...(current.socialLinks.length > 0 ? current.socialLinks : [""]), ""] }));
    setLinkFocus({ target: linkRows.length });
  };
  const removeLink = (index: number) => {
    setValues((current) => ({ ...current, socialLinks: current.socialLinks.filter((_, i) => i !== index) }));
    setLinkFocus({ target: "add" });
  };
  const set = (name: Exclude<keyof ProfileFormValues, "socialLinks">) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  const describedBy = (name: ProfileFormField, hint: boolean) =>
    [hint ? `${fieldId[name]}-dica` : null, invalid.has(name) ? `${fieldId[name]}-erro` : null].filter(Boolean).join(" ") ||
    undefined;
  const errorText = (name: ProfileFormField) =>
    invalid.has(name) ? (
      <p id={`${fieldId[name]}-erro`} className="text-lg font-semibold text-red-800 dark:text-red-300">
        {name === "whatsapp" && state.status === "duplicate_whatsapp" ? text.duplicateWhatsapp : text.fieldErrors[name]}
      </p>
    ) : null;

  return (
    <form
      action={formAction}
      // Com JavaScript, envia sem o "reset" automático do React, que limparia as listas de
      // escolha depois de um erro. Sem JavaScript, o `action` acima funciona igual.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      noValidate
      className="flex flex-col gap-8"
    >
      <p className="text-lg">{text.intro}</p>

      {state.status !== "idle" && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-xl border-2 border-red-700 p-4 text-lg focus:outline-none focus-visible:ring-4">
          {state.status === "failed" || state.status === "too_many_attempts" ? (
            <p>{state.status === "failed" ? text.failed : text.tooManyAttempts}</p>
          ) : (
            <>
              <p className="font-semibold">{text.errorSummary}</p>
              <ul className="mt-2 list-disc pl-6">
                {fieldOrder
                  .filter((name) => invalid.has(name))
                  .map((name) => (
                    <li key={name}>
                      <a href={`#${name === "socialLinks" ? linkId(badLinks.size > 0 ? Math.min(...badLinks) : 0) : fieldId[name]}`} className="underline">
                        {name === "whatsapp" && state.status === "duplicate_whatsapp" ? text.duplicateWhatsapp : text.fieldErrors[name]}
                      </a>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId.displayName} className="text-xl font-semibold">
          {text.nameLabel}
        </label>
        <p id={`${fieldId.displayName}-dica`} className="text-base">
          {text.nameHint}
        </p>
        <input
          id={fieldId.displayName}
          name="displayName"
          type="text"
          autoComplete="name"
          maxLength={80}
          required
          value={values.displayName}
          onChange={set("displayName")}
          aria-invalid={invalid.has("displayName")}
          aria-describedby={describedBy("displayName", true)}
          className={inputClass}
        />
        {errorText("displayName")}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId.whatsapp} className="text-xl font-semibold">
          {text.whatsappLabel}
        </label>
        <p id={`${fieldId.whatsapp}-dica`} className="text-base">
          {text.whatsappHint}
        </p>
        <input
          id={fieldId.whatsapp}
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={whatsappInputMaxLength}
          required
          value={values.whatsapp}
          onChange={(event) => setValues((current) => ({ ...current, whatsapp: formatBrazilianWhatsapp(event.target.value) }))}
          aria-invalid={invalid.has("whatsapp")}
          aria-describedby={describedBy("whatsapp", true)}
          className={inputClass}
        />
        {errorText("whatsapp")}
      </div>

      <LocationFields
        values={values}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        states={states}
        initialMunicipalities={initialMunicipalities}
        initialDistricts={initialDistricts}
        loadMunicipalities={loadMunicipalities}
        loadDistricts={loadDistricts}
        text={text}
        ids={{ state: "perfil-estado", municipalitySearch: "perfil-cidade-busca", municipality: fieldId.municipalityCode, district: fieldId.district }}
        inputClass={inputClass}
        describedBy={describedBy}
        errorText={errorText}
        isInvalid={(name) => invalid.has(name)}
      />

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId.neighborhood} className="text-xl font-semibold">
          {text.neighborhoodLabel}
        </label>
        <p id={`${fieldId.neighborhood}-dica`} className="text-base">
          {text.neighborhoodHint}
        </p>
        <input
          id={fieldId.neighborhood}
          name="neighborhood"
          type="text"
          autoComplete="off"
          maxLength={profileLimits.neighborhoodMax}
          disabled={values.municipalityCode === ""}
          value={values.neighborhood}
          onChange={set("neighborhood")}
          aria-invalid={invalid.has("neighborhood")}
          aria-describedby={describedBy("neighborhood", true)}
          className={inputClass}
        />
        {errorText("neighborhood")}
      </div>

      <fieldset
        id={fieldId.socialLinks}
        aria-describedby={describedBy("socialLinks", true)}
        className="flex flex-col gap-4"
      >
        <legend className="text-xl font-semibold">{text.socialLinksLabel}</legend>
        <p id={`${fieldId.socialLinks}-dica`} className="text-base">
          {text.socialLinksHint}
        </p>
        {errorText("socialLinks")}
        {!editingLinks && (
          <>
            <p role="status" className="rounded-xl border-2 border-current p-4 text-lg">
              {text.socialLinksUnreadable}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingLinks(true);
                setValues((current) => ({ ...current, socialLinks: [] }));
                setLinkFocus({ target: 0 });
              }}
              className={buttonClass}
            >
              {text.replaceSocialLinks}
            </button>
          </>
        )}
        {editingLinks && <input type="hidden" name={socialLinksSentField} value="1" />}
        {editingLinks && linkRows.map((link, index) => (
          <div key={index} className="flex flex-col gap-2">
            <label htmlFor={linkId(index)} className="text-lg font-semibold">
              {text.socialLinkLabel} {index + 1}
            </label>
            <input
              id={linkId(index)}
              name="socialLinks"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={profileLimits.socialLinkMaxLength}
              value={link}
              onChange={(event) => setLink(index, event.target.value)}
              aria-invalid={badLinks.has(index)}
              aria-describedby={badLinks.has(index) ? `${fieldId.socialLinks}-erro` : `${fieldId.socialLinks}-dica`}
              className={inputClass}
            />
            {values.socialLinks.length > 0 && (
              <button type="button" onClick={() => removeLink(index)} className={buttonClass}>
                {text.removeSocialLink} {index + 1}
              </button>
            )}
          </div>
        ))}
        {editingLinks && linkRows.length < profileLimits.socialLinksMax && (
          <button ref={addLinkRef} type="button" onClick={addLink} className={buttonClass}>
            {text.addSocialLink}
          </button>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="block w-full rounded-xl px-6 py-5 text-center text-xl font-semibold text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 disabled:opacity-70"
        style={{ backgroundColor: "var(--color-primary)" }}
      >
        {pending ? text.saving : text.saveButton}
      </button>
    </form>
  );
}
