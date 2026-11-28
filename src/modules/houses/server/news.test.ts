import { describe, expect, it } from "vitest";
import type { HouseClient, HouseQuery } from "../types";
import { newsLimit, readNews } from "./news";

// Leitor das novidades da página inicial (#307): a RLS já recorta pelo nível da pessoa; aqui só se pede as mais novas,
// valida a forma e devolve campos tipados. Nenhum HTML chega à tela: o React escapa o texto.
const ROW = { id: "00000000-0000-4000-8000-000000000001", title: "Encontro", body: "Sábado, 10h.", link: "https://exemplo.org/x", published_at: "2026-11-28T10:00:00Z" };

type Call = { table: string; columns: string; order?: [string, boolean]; limit?: number };
function fakeClient(result: { data?: unknown; error?: unknown }) {
  const call: Call = { table: "", columns: "" };
  const query: HouseQuery = Object.assign(Promise.resolve({ data: result.data ?? null, error: result.error ?? null }), {
    eq: () => query,
    is: () => query,
    not: () => query,
    neq: () => query,
    in: () => query,
    order: (column: string, options: { ascending: boolean }) => ((call.order = [column, options.ascending]), query),
    limit: (count: number) => ((call.limit = count), query),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  });
  const client: HouseClient = {
    rpc: () => {
      throw new Error("o leitor só usa a tabela");
    },
    from: (table) => ({ select: (columns) => ((call.table = table), (call.columns = columns), query) }),
  };
  return { client, call };
}

describe("readNews", () => {
  it("pede as mais novas primeiro, até o teto, e devolve campos tipados", async () => {
    const { client, call } = fakeClient({ data: [ROW, { ...ROW, id: "00000000-0000-4000-8000-000000000002", link: null }] });
    const out = await readNews(client);
    expect(call).toMatchObject({ table: "news", order: ["published_at", false], limit: newsLimit });
    expect(newsLimit).toBe(5);
    expect(out).toEqual([
      { id: ROW.id, title: "Encontro", body: "Sábado, 10h.", link: "https://exemplo.org/x", publishedAt: "2026-11-28T10:00:00Z" },
      { id: "00000000-0000-4000-8000-000000000002", title: "Encontro", body: "Sábado, 10h.", link: null, publishedAt: "2026-11-28T10:00:00Z" },
    ]);
  });

  it("sem linhas: lista vazia", async () => {
    expect(await readNews(fakeClient({ data: [] }).client)).toEqual([]);
  });

  it("erro do banco ou forma inesperada: lança só o código, sem a mensagem", async () => {
    await expect(readNews(fakeClient({ error: { code: "42501", message: "detalhe interno" } }).client)).rejects.toThrow("news_read_failed:42501");
    await expect(readNews(fakeClient({ data: [{ id: "x" }] }).client)).rejects.toThrow("news_read_failed:shape");
    await expect(readNews(fakeClient({ error: { code: "42501", message: "detalhe interno" } }).client)).rejects.not.toThrow(/interno/);
  });
});
