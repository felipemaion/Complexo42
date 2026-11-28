"use client";

import { useActionState, useId, useState } from "react";
import { buttonClass, noticeClass } from "@/modules/ui";
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
        <p role="alert" className={noticeClass("error")}>
          {errorText}
        </p>
      )}
      <label className="flex cursor-pointer items-start gap-4 text-lg leading-relaxed">
        <input
          type="checkbox"
          name="accepted"
          checked={isChecked}
          onChange={(event) => setIsChecked(event.target.checked)}
          className="mt-0.5 size-7 shrink-0 accent-primary"
        />
        <span>{term.checkboxLabel}</span>
      </label>
      <button
        type="submit"
        disabled={!isChecked || isPending}
        aria-describedby={isChecked ? undefined : hintId}
        className={buttonClass("primary", "lg")}
      >
        {term.continueButton}
      </button>
      {!isChecked && (
        <p id={hintId} className="text-lg text-ink-muted">
          {term.uncheckedHint}
        </p>
      )}
    </form>
  );
}
