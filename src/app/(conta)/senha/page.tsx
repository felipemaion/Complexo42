import type { Metadata } from "next";
import { instance } from "@config/instance";
import { usesGoogleSignIn } from "@/server/auth/password-flows";
import { requireUserClient } from "@/server/auth/session";
import { removePasswordAction, setPasswordAction } from "./actions";
import { PasswordForm } from "./password-form";
import { PASSWORD_STATUS_PARAM, parsePasswordStatus } from "./status";
import { cardClass, noticeClass, PageShell } from "@/modules/ui";

export const metadata: Metadata = { title: instance.password.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Criar, trocar ou remover a senha (ADR 0018). Quem entra pelo Google não usa senha: vê só o aviso.
export default async function PasswordPage({ searchParams }: Props) {
  const { client } = await requireUserClient();
  const [{ data }, params] = await Promise.all([client.auth.getUser(), searchParams]);
  const text = instance.password;
  const status = parsePasswordStatus(params[PASSWORD_STATUS_PARAM]);
  const isDone = status === "saved" || status === "removed";
  const notice = status === "saved" ? text.status.saved : status === "removed" ? text.status.removed : status === "google" ? text.googleMessage : status ? text.errors[status] : null;
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      {notice && (
        <p role={isDone || status === "google" ? "status" : "alert"} className={noticeClass(isDone ? "success" : status === "google" ? "info" : "error")}>
          {notice}
        </p>
      )}
      {usesGoogleSignIn(data.user) ? (
        <p className="text-lg">{text.googleMessage}</p>
      ) : (
        <div className={cardClass()}>
          <p className="max-w-prose text-lg text-ink-muted">{text.intro}</p>
          <PasswordForm saveAction={setPasswordAction} removeAction={removePasswordAction} text={text} idPrefix="senha" />
        </div>
      )}
    </PageShell>
  );
}
