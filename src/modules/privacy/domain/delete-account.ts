// "Excluir minha conta" (issue #18, LGPD art. 18, VI). Regras puras: sem banco, sem React.
import { z } from "zod";

/** Página com o aviso e a confirmação (fora de `(conta)`: quem está na espera também exclui). */
export const DELETE_ACCOUNT_PATH = "/excluir-conta";
/** Parâmetro da URL com o motivo de voltar para a página da exclusão. */
export const DELETE_ACCOUNT_STATUS_PARAM = "erro";

/**
 * Janela da reautenticação: o login mais recente da sessão precisa ter no máximo isto. Igual a
 * `reauth_window` em `public.delete_own_account()` (o banco confere de novo; isto só decide o
 * que a tela mostra).
 */
export const REAUTH_WINDOW_SECONDS = 600;

/** O que a pessoa digita para confirmar. Comparado sem diferenciar maiúsculas. */
export const CONFIRMATION_WORD = "EXCLUIR";

export const deleteAccountStatuses = ["confirmacao", "reautenticar", "falhou"] as const;
export type DeleteAccountStatus = (typeof deleteAccountStatuses)[number];

export function parseDeleteAccountStatus(raw: unknown): DeleteAccountStatus | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (deleteAccountStatuses as readonly unknown[]).includes(value) ? (value as DeleteAccountStatus) : null;
}

/** O formulário da confirmação, validado no servidor (o navegador só ajuda). */
export const deleteAccountFormSchema = z.object({
  confirmation: z
    .string()
    .max(64)
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.literal(CONFIRMATION_WORD)),
});

const amrSchema = z.object({
  amr: z.array(z.object({ timestamp: z.number().int() }).loose()).min(1),
});

/**
 * Segundos desde o login mais recente, lidos do `amr` do JWT da sessão (o GoTrue grava a hora
 * de cada forma de entrada e não muda na renovação do token). `null` se o token não diz.
 * Não confere a assinatura: serve só para a tela; quem decide é o banco.
 */
export function authAgeSeconds(
  accessToken: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = amrSchema.safeParse(claims);
  if (!parsed.success) return null;
  return nowSeconds - Math.max(...parsed.data.amr.map((m) => m.timestamp));
}

/** Entrou há pouco o bastante para excluir sem entrar de novo? */
export function isRecentLogin(ageSeconds: number | null): boolean {
  return ageSeconds !== null && ageSeconds <= REAUTH_WINDOW_SECONDS;
}
