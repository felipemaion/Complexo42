import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import {
  authAgeSeconds,
  CONFIRMATION_WORD,
  DELETE_ACCOUNT_STATUS_PARAM,
  isRecentLogin,
  parseDeleteAccountStatus,
  type DeleteAccountStatus,
} from "@/modules/privacy";
import { HOME_PATH } from "@/server/auth/routes";
import { requireSessionClient } from "@/server/auth/session";
import { deleteAccountAction, reauthenticateAction } from "./actions";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.deleteAccount.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const button = buttonClass("danger", "lg");

const statusText: Record<DeleteAccountStatus, string> = {
  confirmacao: instance.deleteAccount.invalidConfirmation,
  reautenticar: instance.deleteAccount.reauthRequired,
  falhou: instance.deleteAccount.failed,
};

// "Excluir minha conta" (#18). Fora de `(conta)`: o portão de acesso mandaria quem está na espera
// para /espera, e essa pessoa também tem o direito de excluir. Exige sessão (o proxy e
// requireSessionClient). Com login de mais de 10 minutos, a tela pede para entrar de novo; o
// banco confere a mesma regra na hora de apagar.
export default async function DeleteAccountPage({ searchParams }: Props) {
  const { accessToken } = await requireSessionClient();
  const status = parseDeleteAccountStatus((await searchParams)[DELETE_ACCOUNT_STATUS_PARAM]);
  // O amr é só uma pista; se o banco já recusou por login antigo, a tela segue o banco.
  const recent = status !== "reautenticar" && isRecentLogin(authAgeSeconds(accessToken));
  const text = instance.deleteAccount;
  return (
    <PageShell width="form" isCentered>
      <h1 className="text-3xl font-bold sm:text-4xl">{text.title}</h1>
      {status && (
        <p role="alert" className={noticeClass("error")}>
          {statusText[status]}
        </p>
      )}
      <div className={`${noticeClass("error")} flex flex-col gap-3`} data-testid="delete-account-warnings">
        {text.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
      {recent ? (
        <form action={deleteAccountAction} className={cardClass()}>
          <label htmlFor="confirmation" className="text-lg font-semibold">
            {text.confirmLabel}
          </label>
          <input
            id="confirmation"
            name="confirmation"
            type="text"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            placeholder={CONFIRMATION_WORD}
            className={fieldClass()}
          />
          <button type="submit" className={button}>
            {text.confirmButton}
          </button>
        </form>
      ) : (
        <form action={reauthenticateAction} className={cardClass()}>
          <p className="text-lg">{text.reauthMessage}</p>
          <button type="submit" className={buttonClass("secondary", "lg")}>
            {text.reauthButton}
          </button>
        </form>
      )}
      <Link href={HOME_PATH} className={`${textLinkClass()} self-center`}>
        {text.cancelLink}
      </Link>
    </PageShell>
  );
}
