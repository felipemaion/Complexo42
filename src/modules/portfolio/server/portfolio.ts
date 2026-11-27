import "server-only";
import { z } from "zod";
import { parsePortfolioLink, youtubeEmbedUrl } from "../domain/link";

// Portfólio por links (#70). O link é validado (mesma regra das redes, #17) e cifrado ANTES de ir
// ao banco; na leitura é decifrado e validado de novo (o valor guardado nunca vira href sem passar
// pela regra). O banco decide quem pode (só a dona edita; o escopo vê).

export const PORTFOLIO_KINDS = ["video", "image", "text", "other"] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

export type PortfolioClient = {
  readonly rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};

export type PortfolioItem = {
  readonly id: string;
  readonly kind: PortfolioKind;
  readonly title: string;
  readonly href: string;
  readonly embedUrl: string | null;
};

export type PortfolioError = "invalid" | "full" | "not_allowed" | "failed";
export type PortfolioResult = { readonly ok: true } | { readonly ok: false; readonly error: PortfolioError };

const addInput = z.object({
  url: z.string().max(2048),
  kind: z.enum(PORTFOLIO_KINDS),
  title: z.string().trim().min(1).max(80),
});

const rows = z.array(
  z.object({ id: z.guid(), url_enc: z.string(), kind: z.enum(PORTFOLIO_KINDS), title: z.string(), position: z.number() }),
);

function mapError(error: unknown): PortfolioError {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  if (code === "42501") return "not_allowed";
  if (code === "22023") return message.includes("até 3") ? "full" : "invalid";
  return "failed";
}

export async function addPortfolioItem(
  client: PortfolioClient,
  input: unknown,
  encrypt: (href: string) => Promise<string>,
): Promise<PortfolioResult> {
  const parsed = addInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const href = parsePortfolioLink(parsed.data.url);
  if (!href) return { ok: false, error: "invalid" };

  const { error } = await client.rpc("add_portfolio_item", {
    p_url_enc: await encrypt(href),
    p_kind: parsed.data.kind,
    p_title: parsed.data.title,
  });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

export async function removePortfolioItem(client: PortfolioClient, itemId: unknown): Promise<PortfolioResult> {
  const parsed = z.guid().safeParse(itemId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await client.rpc("remove_portfolio_item", { p_item: parsed.data });
  return error ? { ok: false, error: mapError(error) } : { ok: true };
}

/** Itens de uma pessoa que quem está logado pode ver, já decifrados e prontos para a tela. */
export async function readPortfolio(
  client: PortfolioClient,
  profileId: string,
  decrypt: (value: string) => Promise<string>,
): Promise<readonly PortfolioItem[]> {
  const { data, error } = await client.rpc("portfolio_list", { p_profile: profileId });
  if (error) throw new Error("portfolio_read_failed");
  const parsed = rows.safeParse(data);
  if (!parsed.success) throw new Error("portfolio_read_failed");

  const items = await Promise.all(
    parsed.data.map(async (row) => {
      const href = parsePortfolioLink(await decrypt(row.url_enc).catch(() => ""));
      return href ? { id: row.id, kind: row.kind, title: row.title, href, embedUrl: youtubeEmbedUrl(href) } : null;
    }),
  );
  return items.filter((item): item is PortfolioItem => item !== null);
}
