"use client";
// Formulário da senha (ADR 0018): nova senha, confirmação e medidor simples. O medidor usa a
// MESMA política do servidor (password-policy.ts, pura). A senha fica só nos campos do formulário:
// sem estado global, sem armazenamento do navegador, sem envio fora do POST da server action.
import { useState } from "react";
import { passwordStrength, type PasswordStrength } from "@/server/auth/password-policy";

type FormAction = (formData: FormData) => void | Promise<void>;

export type PasswordFormText = {
  rules: string;
  currentLabel: string;
  currentHint: string;
  newLabel: string;
  confirmLabel: string;
  saveButton: string;
  removeButton: string;
  removeHint: string;
  meterLabel: string;
  strength: Record<PasswordStrength, string>;
};

const field = "w-full rounded-xl border-2 border-neutral-400 bg-transparent px-4 py-4 text-xl";
const bigButton = "block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";
const bars: Record<PasswordStrength, number> = { weak: 1, ok: 2, strong: 3 };

export function PasswordForm({
  saveAction,
  removeAction,
  text,
  idPrefix,
}: {
  saveAction: FormAction;
  /** Só na página da senha: quem ainda está criando a primeira não tem o que remover. */
  removeAction?: FormAction;
  text: PasswordFormText;
  idPrefix: string;
}) {
  const [password, setPassword] = useState("");
  const strength = passwordStrength(password);
  return (
    <form action={saveAction} className="flex flex-col gap-3">
      <p className="text-lg">{text.rules}</p>
      {removeAction && (
        <>
          <label htmlFor={`${idPrefix}-current`} className="text-lg font-medium">
            {text.currentLabel}
          </label>
          <input id={`${idPrefix}-current`} name="current_password" type="password" autoComplete="current-password" maxLength={256} className={field} />
          <p className="text-base">{text.currentHint}</p>
        </>
      )}
      <label htmlFor={`${idPrefix}-new`} className="text-lg font-medium">
        {text.newLabel}
      </label>
      <input
        id={`${idPrefix}-new`}
        name="password"
        type="password"
        autoComplete="new-password"
        maxLength={256}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby={`${idPrefix}-meter`}
        className={field}
      />
      {/* Medidor: três traços e o texto, para não depender só da cor. */}
      <div id={`${idPrefix}-meter`} role="status" aria-live="polite" className="flex items-center gap-3 text-base">
        <span aria-hidden="true" className="flex gap-1">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-2 w-8 rounded ${password !== "" && n <= bars[strength] ? "bg-current" : "bg-neutral-300"}`} />
          ))}
        </span>
        {password !== "" && (
          <span>
            {text.meterLabel}: {text.strength[strength]}
          </span>
        )}
      </div>
      <label htmlFor={`${idPrefix}-confirm`} className="text-lg font-medium">
        {text.confirmLabel}
      </label>
      <input id={`${idPrefix}-confirm`} name="confirmation" type="password" autoComplete="new-password" maxLength={256} className={field} />
      <button type="submit" className={bigButton}>
        {text.saveButton}
      </button>
      {removeAction && (
        <>
          <button type="submit" formAction={removeAction} className={bigButton}>
            {text.removeButton}
          </button>
          <p className="text-base">{text.removeHint}</p>
        </>
      )}
    </form>
  );
}
