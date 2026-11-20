"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { socialLinksSentField, type ProfileFormField } from "../domain/form";
import { profileLimits } from "../domain/schema";
import { formatBrazilianWhatsapp, whatsappInputMaxLength } from "../domain/whatsapp";
import type { MunicipalityOption, ProfileFormState, ProfileFormValues } from "../types";

// Formulário do perfil (issue #12). Só apresentação e eventos: quem valida, cifra e grava é a
// server action (no servidor). Mobile-first, botões e letras grandes, tudo à vista e em
// linguagem simples (pedido do stakeholder; o público inclui pessoas mais velhas).

export type ProfileFormText = {
  intro: string;
  nameLabel: string;
  nameHint: string;
  whatsappLabel: string;
  whatsappHint: string;
  municipalityLabel: string;
  municipalityPlaceholder: string;
  districtLabel: string;
  districtHint: string;
  districtNone: string;
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
  municipalities: readonly MunicipalityOption[];
  /** Distritos por código IBGE; só os municípios daqui mostram a escolha de distrito. */
  districts: Readonly<Record<number, readonly string[]>>;
  /**
   * Os links guardados não abriram inteiros (#17): sem caixas nem o campo escondido, para o
   * servidor manter o valor cifrado, até a pessoa tocar em "trocar".
   */
  socialLinksUnreadable?: boolean;
  text: ProfileFormText;
};

const inputClass =
  "w-full rounded-xl border-2 border-field bg-surface text-ink px-4 py-4 text-xl aria-[invalid=true]:border-danger focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2";
const fieldOrder: readonly ProfileFormField[] = ["displayName", "whatsapp", "municipalityCode", "district", "socialLinks"];
const fieldId: Record<ProfileFormField, string> = {
  displayName: "perfil-nome",
  whatsapp: "perfil-whatsapp",
  municipalityCode: "perfil-cidade",
  district: "perfil-distrito",
  socialLinks: "perfil-redes",
};
const linkId = (index: number) => `perfil-rede-${index + 1}`;
const buttonClass =
  "block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-6 py-4 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2";

export function ProfileForm({ action, initial, municipalities, districts, socialLinksUnreadable = false, text }: Props) {
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
  const districtOptions = districts[Number(values.municipalityCode)];
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
      <p id={`${fieldId[name]}-erro`} className="text-lg font-semibold text-danger">
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
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-xl border-l-4 border-danger bg-danger-soft p-4 text-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-focus">
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

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId.municipalityCode} className="text-xl font-semibold">
          {text.municipalityLabel}
        </label>
        <select
          id={fieldId.municipalityCode}
          name="municipalityCode"
          required
          value={values.municipalityCode}
          onChange={(event) => setValues((current) => ({ ...current, municipalityCode: event.target.value, district: "" }))}
          aria-invalid={invalid.has("municipalityCode")}
          aria-describedby={describedBy("municipalityCode", false)}
          className={inputClass}
        >
          <option value="">{text.municipalityPlaceholder}</option>
          {municipalities.map((m) => (
            <option key={m.code} value={String(m.code)}>
              {m.name}
            </option>
          ))}
        </select>
        {errorText("municipalityCode")}
      </div>

      {districtOptions && (
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId.district} className="text-xl font-semibold">
            {text.districtLabel}
          </label>
          <p id={`${fieldId.district}-dica`} className="text-base">
            {text.districtHint}
          </p>
          <select
            id={fieldId.district}
            name="district"
            value={values.district}
            onChange={set("district")}
            aria-invalid={invalid.has("district")}
            aria-describedby={describedBy("district", true)}
            className={inputClass}
          >
            <option value="">{text.districtNone}</option>
            {[...districtOptions]
              .sort((a, b) => a.localeCompare(b, "pt-BR"))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
          {errorText("district")}
        </div>
      )}

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
            <p role="status" className="rounded-xl border-2 border-line bg-surface p-4 text-lg">
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
        className="block w-full rounded-xl px-6 py-5 text-center text-xl font-semibold text-on-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-70"
       
      >
        {pending ? text.saving : text.saveButton}
      </button>
    </form>
  );
}
