"use client";
// Autorizar um e-mail à mão (#258). Só apresentação: o e-mail vai para a server action, que
// valida, vira HMAC e descarta. A tela só confirma "Adicionado" ou "já estava na lista" (nunca
// diz se a pessoa tem conta) e limpa o campo depois de adicionar.
import { useActionState, useEffect, useRef } from "react";
import { ALLOWLIST_EMAIL_FIELD, type AddEmailError, type AddEmailState } from "../domain/coordination";

export type AllowlistAddEmailText = {
  title: string;
  label: string;
  hint: string;
  button: string;
  adding: string;
  added: string;
  already: string;
  errors: Record<AddEmailError, string>;
};

type Props = { action: (state: AddEmailState, formData: FormData) => Promise<AddEmailState>; text: AllowlistAddEmailText };

export function AllowlistAddEmailForm({ action, text }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  // O campo limpa só quando entrou (ou já estava): erro mantém o texto para corrigir.
  useEffect(() => {
    if (state.status === "added" || state.status === "already") formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4" data-testid="allowlist-add-email">
      <h2 className="text-2xl font-bold">{text.title}</h2>
      {state.status === "error" && (
        <p role="alert" className="rounded-lg border-2 border-current p-4 text-lg" data-testid="allowlist-add-error">
          {text.errors[state.error]}
        </p>
      )}
      {(state.status === "added" || state.status === "already") && (
        <p role="status" className="rounded-lg border-2 border-current p-4 text-lg font-bold" data-testid="allowlist-add-done">
          {state.status === "added" ? text.added : text.already}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="allowlist-email" className="text-xl font-bold">
          {text.label}
        </label>
        <input
          id="allowlist-email"
          name={ALLOWLIST_EMAIL_FIELD}
          type="email"
          required
          autoComplete="off"
          maxLength={254}
          aria-describedby="allowlist-email-hint"
          className="rounded-xl border-2 border-current px-4 py-4 text-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2"
        />
        <p id="allowlist-email-hint" className="text-base">
          {text.hint}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border-2 border-current px-6 py-5 text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {pending ? text.adding : text.button}
      </button>
    </form>
  );
}
