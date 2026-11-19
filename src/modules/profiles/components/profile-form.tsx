"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { ProfileFormField } from "../domain/form";
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
  text: ProfileFormText;
};

const inputClass =
  "w-full rounded-xl border-2 border-neutral-500 bg-transparent px-4 py-4 text-xl aria-[invalid=true]:border-red-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";
const fieldOrder: readonly ProfileFormField[] = ["displayName", "whatsapp", "municipalityCode", "district"];
const fieldId: Record<ProfileFormField, string> = {
  displayName: "perfil-nome",
  whatsapp: "perfil-whatsapp",
  municipalityCode: "perfil-cidade",
  district: "perfil-distrito",
};

export function ProfileForm({ action, initial, municipalities, districts, text }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ProfileFormState);
  const [values, setValues] = useState<ProfileFormValues>(initial);
  const summaryRef = useRef<HTMLDivElement>(null);

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

  const invalid = new Set<ProfileFormField>(state.status === "invalid" ? state.fields : []);
  if (state.status === "duplicate_whatsapp") invalid.add("whatsapp");
  const districtOptions = districts[Number(values.municipalityCode)];
  const set = (name: keyof ProfileFormValues) => (event: { target: { value: string } }) =>
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
                      <a href={`#${fieldId[name]}`} className="underline">
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
