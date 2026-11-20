"use client";

import { useActionState, useId, useState } from "react";
import type { ConsentFormState, ConsentTerm } from "../domain/consent";

// Caixa de aceite e botão do termo (#11). A caixa vem DESMARCADA e o botão só habilita depois
// de marcá-la; isso é conforto: o servidor confere o campo de novo antes de gravar.
export function ConsentForm({
  action,
  term,
}: Readonly<{
  action: (previous: ConsentFormState, formData: FormData) => Promise<ConsentFormState>;
  term: Pick<ConsentTerm, "checkboxLabel" | "continueButton" | "uncheckedHint" | "errors">;
}>) {
  const [state, formAction, isPending] = useActionState<ConsentFormState, FormData>(action, { status: "idle" });
  const [isChecked, setIsChecked] = useState(false);
  const hintId = useId();
  const errorText = state.status === "unchecked" ? term.errors.unchecked : state.status === "failed" ? term.errors.failed : null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {errorText && (
        <p role="alert" className="rounded-xl border-l-4 border-primary bg-soft p-4 text-xl">
          {errorText}
        </p>
      )}
      <label className="flex items-start gap-4 text-xl leading-relaxed">
        <input
          type="checkbox"
          name="accepted"
          checked={isChecked}
          onChange={(event) => setIsChecked(event.target.checked)}
          className="mt-1 h-8 w-8 shrink-0"
        />
        <span>{term.checkboxLabel}</span>
      </label>
      <button
        type="submit"
        disabled={!isChecked || isPending}
        aria-describedby={isChecked ? undefined : hintId}
        className="block w-full rounded-xl border-2 border-primary bg-surface text-primary no-underline px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {term.continueButton}
      </button>
      {!isChecked && (
        <p id={hintId} className="text-lg">
          {term.uncheckedHint}
        </p>
      )}
    </form>
  );
}
