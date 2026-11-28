"use client";
// Autorizar um e-mail à mão (#258). Só apresentação: o e-mail vai para a server action, que
// valida, vira HMAC e descarta. A tela só confirma "Adicionado" ou "já estava na lista" (nunca
// diz se a pessoa tem conta) e limpa o campo depois de adicionar.
import { useActionState, useEffect, useRef } from "react";
import { ALLOWLIST_EMAIL_FIELD, type AddEmailError, type AddEmailState } from "../domain/coordination";
import { buttonClass, fieldClass, noticeClass } from "@/modules/ui";

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
        <p role="alert" className={noticeClass("error")} data-testid="allowlist-add-error">
          {text.errors[state.error]}
        </p>
      )}
      {(state.status === "added" || state.status === "already") && (
        <p role="status" className={`${noticeClass("success")} font-bold`} data-testid="allowlist-add-done">
          {state.status === "added" ? text.added : text.already}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="allowlist-email" className="text-lg font-bold">
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
          className={fieldClass()}
        />
        <p id="allowlist-email-hint" className="text-base text-ink-muted">
          {text.hint}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "lg")}
      >
        {pending ? text.adding : text.button}
      </button>
    </form>
  );
}
