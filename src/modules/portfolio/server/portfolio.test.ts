import { describe, expect, it, vi } from "vitest";
import { addPortfolioItem, readPortfolio, removePortfolioItem } from "./portfolio";

vi.mock("server-only", () => ({}));

const profileId = "0b7e28b8-07cb-4f9e-a89c-3fa82944ce26";
const itemId = "c38bdfae-f1f4-41d6-b8db-41710928a38b";
const encrypt = vi.fn(async (href: string) => `enc(${href})`);

describe("portfólio no servidor (#70)", () => {
  it("cifra o link normalizado e chama add_portfolio_item", async () => {
    // Arrange
    const rpc = vi.fn().mockResolvedValue({ data: itemId, error: null });

    // Act
    const result = await addPortfolioItem({ rpc }, { url: "youtu.be/dQw4w9WgXcQ", kind: "video", title: "  Corte do debate " }, encrypt);

    // Assert
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("add_portfolio_item", { p_url_enc: "enc(https://youtu.be/dQw4w9WgXcQ)", p_kind: "video", p_title: "Corte do debate" });
  });

  it("link perigoso nem é cifrado nem vai ao banco", async () => {
    const rpc = vi.fn();
    const enc = vi.fn();

    const result = await addPortfolioItem({ rpc }, { url: "javascript:alert(1)", kind: "video", title: "x" }, enc);

    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(enc).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o banco recusando o 4º item vira 'full'", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "22023", message: "o portfólio tem até 3 itens" } });

    const result = await addPortfolioItem({ rpc }, { url: "https://exemplo.com/a", kind: "text", title: "Quarto" }, encrypt);

    expect(result).toEqual({ ok: false, error: "full" });
  });

  it("lê, decifra e monta a prévia só para o YouTube; link que não passa na regra some", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { id: itemId, url_enc: "e1", kind: "video", title: "Vídeo", position: 1 },
        { id: profileId, url_enc: "e2", kind: "image", title: "Arte", position: 2 },
        { id: "11111111-1111-4111-8111-111111111111", url_enc: "e3", kind: "other", title: "Ruim", position: 3 },
      ],
      error: null,
    });
    const plain: Record<string, string> = { e1: "https://youtu.be/dQw4w9WgXcQ", e2: "https://instagram.com/p/abc", e3: "javascript:alert(1)" };

    const items = await readPortfolio({ rpc }, profileId, async (value) => plain[value] ?? "");

    expect(rpc).toHaveBeenCalledWith("portfolio_list", { p_profile: profileId });
    expect(items).toEqual([
      { id: itemId, kind: "video", title: "Vídeo", href: "https://youtu.be/dQw4w9WgXcQ", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" },
      { id: profileId, kind: "image", title: "Arte", href: "https://instagram.com/p/abc", embedUrl: null },
    ]);
  });

  it("tirar item chama remove_portfolio_item; id inválido nem vai ao banco", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    expect(await removePortfolioItem({ rpc }, itemId)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("remove_portfolio_item", { p_item: itemId });
    expect(await removePortfolioItem({ rpc }, "nao-e-id")).toEqual({ ok: false, error: "invalid" });
  });
});
