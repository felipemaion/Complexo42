"use server";
// Portfólio por links (#70): o link é cifrado no servidor com o id de quem está logado como
// contexto (o mesmo usado para decifrar na leitura). Quem pode o banco decide.
import { redirect } from "next/navigation";
import { addPortfolioItem, PORTFOLIO_PATH, removePortfolioItem, sessionPortfolioClient } from "@/modules/portfolio";
import { requireUser } from "@/server/auth/session";
import { encryptField } from "@/server/crypto";
import { log } from "@/server/log";

export async function addPortfolioAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const client = await sessionPortfolioClient();
  if (!client) redirect(`${PORTFOLIO_PATH}?erro=failed`);

  const result = await addPortfolioItem(
    client,
    { url: formData.get("url") ?? "", kind: formData.get("kind"), title: formData.get("title") ?? "" },
    (href) => encryptField(href, { table: "portfolio_items", column: "url_enc", rowId: user.id }),
  );
  if (!result.ok) log.warn("portfolio_action_refused", { reason: result.error });
  redirect(`${PORTFOLIO_PATH}?${result.ok ? "ok=added" : `erro=${result.error}`}`);
}

export async function removePortfolioAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionPortfolioClient();
  if (!client) redirect(`${PORTFOLIO_PATH}?erro=failed`);

  const result = await removePortfolioItem(client, formData.get("itemId"));
  if (!result.ok) log.warn("portfolio_action_refused", { reason: result.error });
  redirect(`${PORTFOLIO_PATH}?${result.ok ? "ok=removed" : `erro=${result.error}`}`);
}
