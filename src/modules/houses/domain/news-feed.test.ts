import { describe, expect, it } from "vitest";
import { buildNewsFeed, safeNewsLink } from "./news-feed";

// Monta o que a área de novidades mostra (#307): o cartão da janela de transferência vem do estado da janela (sem
// duplicar estado) e fica no topo enquanto ela estiver aberta; depois, as novidades publicadas, no máximo 5.
const item = (n: number, link: string | null = null) => ({ id: `id-${n}`, title: `T${n}`, body: `B${n}`, link, publishedAt: "2026-11-28T10:00:00Z" });

describe("buildNewsFeed", () => {
  it("janela fechada e nada publicado: vazio (a área some)", () => {
    expect(buildNewsFeed({ windowOpen: false, items: [] })).toEqual([]);
  });

  it("janela aberta: o cartão dela vem primeiro, antes das publicadas", () => {
    const feed = buildNewsFeed({ windowOpen: true, items: [item(1)] });
    expect(feed.map((entry) => entry.kind)).toEqual(["house_window", "news"]);
  });

  it("janela fechada: só as publicadas", () => {
    expect(buildNewsFeed({ windowOpen: false, items: [item(1), item(2)] }).map((entry) => entry.kind)).toEqual(["news", "news"]);
  });

  it("no máximo 5 publicadas", () => {
    const feed = buildNewsFeed({ windowOpen: false, items: [1, 2, 3, 4, 5, 6, 7].map((n) => item(n)) });
    expect(feed).toHaveLength(5);
  });

  it("link que não passa na regra é descartado, o resto da novidade fica", () => {
    const feed = buildNewsFeed({ windowOpen: false, items: [item(1, "http://exemplo.org"), item(2, "https://exemplo.org/ok")] });
    expect(feed[0]).toMatchObject({ kind: "news", link: null, title: "T1" });
    expect(feed[1]).toMatchObject({ kind: "news", link: "https://exemplo.org/ok" });
  });
});

describe("safeNewsLink", () => {
  it("aceita só https com domínio válido", () => {
    expect(safeNewsLink("https://exemplo.org")).toBe("https://exemplo.org");
    expect(safeNewsLink("https://sub.exemplo.org/a/b?x=1")).toBe("https://sub.exemplo.org/a/b?x=1");
  });
  it.each([
    "http://exemplo.org",
    "javascript:alert(1)",
    "//exemplo.org",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://exemplo.org/a b",
    "https://user@exemplo.org",
    "",
    null,
  ])("recusa %s", (value) => {
    expect(safeNewsLink(value)).toBeNull();
  });
});
