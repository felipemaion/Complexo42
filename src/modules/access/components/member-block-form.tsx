"use client";
// Bloquear ou desbloquear o acesso de quem já entrou (#26). Só apresentação. Funciona sem
// JavaScript: o formulário vai para a server action, que devolve o próximo estado. Primeiro o
// pedido, depois a confirmação ("Sim" ou "Não, voltar", os dois botões de envio); só o "Sim"
// chama o banco. O resultado é neutro: não diz se o e-mail é de alguém (o banco também não).
import { useActionState } from "react";
import { fillText } from "../domain/coordination";
import {
  MEMBER_BLOCK_FIELDS,
  memberBlockReasons,
  wordOf,
  type MemberBlockError,
  type MemberBlockState,
} from "../domain/member-block";
import type { MemberBlockAction, MemberBlockReason } from "../types";
import { buttonClass, fieldClass, noticeClass } from "@/modules/ui";

export type MemberBlockText = {
  emailLabel: string;
  actionLabel: string;
  actions: Record<MemberBlockAction, string>;
  reasonLabel: string;
  reasonNone: string;
  reasons: Record<MemberBlockReason, string>;
  continueButton: string;
  confirm: Record<MemberBlockAction, string>;
  confirmReason: string;
  confirmButton: Record<MemberBlockAction, string>;
  cancelButton: string;
  done: Record<MemberBlockAction, string>;
  errors: Record<MemberBlockError, string>;
};

type Props = {
  action: (state: MemberBlockState, formData: FormData) => Promise<MemberBlockState>;
  text: MemberBlockText;
};

const big = buttonClass("secondary", "lg");
const field = fieldClass();

export function MemberBlockForm({ action, text }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });

  if (state.status === "confirm") {
    const { email, action: requested, reason } = state.request;
    return (
      <form action={formAction} className="flex flex-col gap-4" aria-label={text.actions[requested]}>
        <p role="alert" className="text-lg font-semibold">
          {fillText(text.confirm[requested], { email })}
        </p>
        {reason && <p className="text-lg">{fillText(text.confirmReason, { reason: text.reasons[reason] })}</p>}
        <input type="hidden" name={MEMBER_BLOCK_FIELDS.email} value={email} />
        <input type="hidden" name={MEMBER_BLOCK_FIELDS.action} value={wordOf(requested)} />
        <input type="hidden" name={MEMBER_BLOCK_FIELDS.reason} value={reason ?? ""} />
        <button type="submit" name={MEMBER_BLOCK_FIELDS.step} value="confirmar" disabled={pending} className={buttonClass("danger", "lg")}>
          {text.confirmButton[requested]}
        </button>
        <button type="submit" name={MEMBER_BLOCK_FIELDS.step} value="cancelar" disabled={pending} className={big}>
          {text.cancelButton}
        </button>
      </form>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === "done" && (
        <p role="status" className={noticeClass("success")} data-testid="member-block-done">
          {text.done[state.action]}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className={noticeClass("error")}>
          {text.errors[state.error]}
        </p>
      )}
      <label className="flex flex-col gap-2 text-lg font-semibold">
        {text.emailLabel}
        <input type="email" name={MEMBER_BLOCK_FIELDS.email} required autoComplete="off" maxLength={254} className={field} />
      </label>
      <fieldset className="flex flex-col gap-2 text-lg">
        <legend className="font-semibold">{text.actionLabel}</legend>
        {(["block", "unblock"] as const).map((option) => (
          <label key={option} className="flex items-center gap-3">
            <input type="radio" name={MEMBER_BLOCK_FIELDS.action} value={wordOf(option)} defaultChecked={option === "block"} className="size-6 accent-primary" />
            {text.actions[option]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-2 text-lg font-semibold">
        {text.reasonLabel}
        <select name={MEMBER_BLOCK_FIELDS.reason} defaultValue="" className={field}>
          <option value="">{text.reasonNone}</option>
          {memberBlockReasons.map((reason) => (
            <option key={reason} value={reason}>
              {text.reasons[reason]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" name={MEMBER_BLOCK_FIELDS.step} value="preparar" disabled={pending} className={big}>
        {text.continueButton}
      </button>
    </form>
  );
}
