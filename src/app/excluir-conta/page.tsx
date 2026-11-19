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

export const metadata: Metadata = { title: instance.deleteAccount.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const button =
  "block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

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
  const recent = isRecentLogin(authAgeSeconds(accessToken));
  const status = parseDeleteAccountStatus((await searchParams)[DELETE_ACCOUNT_STATUS_PARAM]);
  const text = instance.deleteAccount;
  return (
    <main className="mx-auto flex max-w-md flex-col justify-center gap-6 p-6 pt-16">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      {status && (
        <p role="alert" className="rounded-lg border-2 border-current p-4 text-lg">
          {statusText[status]}
        </p>
      )}
      <div className="flex flex-col gap-3 text-lg" data-testid="delete-account-warnings">
        {text.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
      {recent ? (
        <form action={deleteAccountAction} className="flex flex-col gap-4">
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
            className="rounded-lg border-2 border-current px-4 py-3 text-xl"
          />
          <button type="submit" className={button}>
            {text.confirmButton}
          </button>
        </form>
      ) : (
        <form action={reauthenticateAction} className="flex flex-col gap-4">
          <p className="text-lg">{text.reauthMessage}</p>
          <button type="submit" className={button}>
            {text.reauthButton}
          </button>
        </form>
      )}
      <Link href={HOME_PATH} className="text-center text-lg underline">
        {text.cancelLink}
      </Link>
    </main>
  );
}
