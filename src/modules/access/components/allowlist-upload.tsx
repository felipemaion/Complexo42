"use client";
// Envio da lista de autorizados (#26). Só apresentação: o arquivo vai para a server action,
// que lê, transforma os e-mails em HMAC e descarta tudo. A tela mostra só as contagens e os
// números das linhas sem e-mail válido, nunca o conteúdo do arquivo.
import { useActionState } from "react";
import {
  ALLOWLIST_FILE_FIELD,
  ALLOWLIST_SOURCE_FIELD,
  allowlistSources,
  fillText,
  previewLines,
  type AllowlistUploadError,
  type AllowlistUploadState,
} from "../domain/coordination";
import type { AllowlistSource } from "../types";

export type AllowlistUploadText = {
  fileLabel: string;
  fileHint: string;
  sourceLabel: string;
  sources: Record<AllowlistSource, string>;
  submitButton: string;
  sending: string;
  doneTitle: string;
  received: string;
  promoted: string;
  invalidLines: string;
  invalidLinesMore: string;
  errors: Record<AllowlistUploadError, string>;
};

type Props = {
  action: (state: AllowlistUploadState, formData: FormData) => Promise<AllowlistUploadState>;
  text: AllowlistUploadText;
};

const big = "rounded-xl border-2 border-current px-6 py-5 text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

export function AllowlistUploadForm({ action, text }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const lines = state.status === "done" ? previewLines(state.invalidLines) : null;
  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === "error" && (
        <p role="alert" className="rounded-lg border-2 border-current p-4 text-lg">
          {text.errors[state.error]}
        </p>
      )}
      {state.status === "done" && lines && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border-2 border-current p-4 text-lg" data-testid="allowlist-result">
          <p className="font-bold">{text.doneTitle}</p>
          <p data-testid="allowlist-received">{fillText(text.received, { count: state.received })}</p>
          <p data-testid="allowlist-promoted">{fillText(text.promoted, { count: state.promoted })}</p>
          {lines.shown.length > 0 && (
            <p data-testid="allowlist-invalid-lines">
              {fillText(text.invalidLines, { lines: lines.shown.join(", ") })}
              {lines.hidden > 0 && ` ${fillText(text.invalidLinesMore, { count: lines.hidden })}`}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="allowlist-file" className="text-xl font-bold">
          {text.fileLabel}
        </label>
        <input
          id="allowlist-file"
          name={ALLOWLIST_FILE_FIELD}
          type="file"
          required
          accept=".csv,.txt,text/csv,text/plain"
          aria-describedby="allowlist-file-hint"
          className="rounded-xl border-2 border-current p-4 text-lg"
        />
        <p id="allowlist-file-hint" className="text-base">
          {text.fileHint}
        </p>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-xl font-bold">{text.sourceLabel}</legend>
        {allowlistSources.map((source, index) => (
          <label key={source} className="flex items-center gap-3 rounded-xl border-2 border-current p-4 text-lg">
            <input type="radio" name={ALLOWLIST_SOURCE_FIELD} value={source} defaultChecked={index === 0} className="size-6" />
            {text.sources[source]}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className={`${big} w-full`}>
        {pending ? text.sending : text.submitButton}
      </button>
    </form>
  );
}
