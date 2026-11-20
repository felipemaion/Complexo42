import { describe, expect, it } from "vitest";
import { parsePortfolioLink, youtubeEmbedUrl } from "./link";

describe("link do portfólio (#70)", () => {
  it("recusa javascript:, http: e data:", () => {
    // Arrange / Act / Assert
    expect(parsePortfolioLink("javascript:alert(1)")).toBeNull();
    expect(parsePortfolioLink("http://exemplo.com/video")).toBeNull();
    expect(parsePortfolioLink("data:text/html,oi")).toBeNull();
  });

  it("aceita https e completa o esquema quando falta", () => {
    expect(parsePortfolioLink("https://instagram.com/p/abc")).toBe("https://instagram.com/p/abc");
    expect(parsePortfolioLink("youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it("vídeo do YouTube vira prévia pelo youtube-nocookie", () => {
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(youtubeEmbedUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("domínio fora da lista nunca vira prévia embutida", () => {
    expect(youtubeEmbedUrl("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeEmbedUrl("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeEmbedUrl("https://instagram.com/p/abc")).toBeNull();
  });

  it("id de vídeo fora do formato não vira prévia", () => {
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=curto")).toBeNull();
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ%22onload")).toBeNull();
  });
});
