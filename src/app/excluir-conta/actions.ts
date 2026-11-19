"use server";
// Server actions do "Excluir minha conta" (#18). Só composição: sessão SEM o portão de acesso
// (quem está na espera também exclui) + serviço do módulo de privacidade, que confere a palavra
// e chama `delete_own_account` com o JWT da pessoa (R14; nunca service_role, R6). Nada da
// pessoa vai para a URL nem para o log (R11).
import { redirect } from "next/navigation";
import { DELETE_ACCOUNT_PATH, DELETE_ACCOUNT_STATUS_PARAM, deleteOwnAccount, type DeleteAccountStatus } from "@/modules/privacy";
import { ACCOUNT_DELETED_PATH, LOGIN_PATH } from "@/server/auth/routes";
import { endSession, requireSessionClient } from "@/server/auth/session";

const back = (status: DeleteAccountStatus) => `${DELETE_ACCOUNT_PATH}?${DELETE_ACCOUNT_STATUS_PARAM}=${status}`;

export async function deleteAccountAction(formData: FormData): Promise<never> {
  const { client } = await requireSessionClient();
  const result = await deleteOwnAccount(client, { confirmation: formData.get("confirmation") });
  switch (result.status) {
    case "deleted":
      // A conta já não existe: encerra a sessão neste aparelho e se despede.
      await endSession();
      redirect(ACCOUNT_DELETED_PATH);
    case "invalid_confirmation":
      redirect(back("confirmacao"));
    case "reauth_required":
      redirect(back("reautenticar"));
    case "failed":
      redirect(back("falhou"));
  }
}

/** Reautenticação: sai e volta ao login, que devolve a pessoa para a exclusão. */
export async function reauthenticateAction(): Promise<never> {
  await endSession();
  redirect(`${LOGIN_PATH}?next=${encodeURIComponent(DELETE_ACCOUNT_PATH)}`);
}
