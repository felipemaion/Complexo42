// Links de rede (#17): só https, normalizados, e o que aparece na tela é texto puro.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SocialLinkList } from "../components/social-links";
import { normalizeSocialLink, socialLinkMaxLength, socialLinkRel, socialLinkView, socialLinkViews } from "./social";

describe("normalizeSocialLink", () => {
  it("aceita https e normaliza (esquema e domínio em minúsculas, https:// quando falta)", () => {
    expect(normalizeSocialLink("https://instagram.com/maria")).toBe("https://instagram.com/maria");
    expect(normalizeSocialLink("  HTTPS://WWW.Instagram.COM/Maria  ")).toBe("https://www.instagram.com/Maria");
    expect(normalizeSocialLink("instagram.com/maria")).toBe("https://instagram.com/maria");
    expect(normalizeSocialLink("www.youtube.com/@maria?si=1#x")).toBe("https://www.youtube.com/@maria?si=1#x");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["javascript: com maiúsculas e espaço", " JaVaScRiPt:alert(document.cookie)"],
    ["javascript: com tab escondido", "java\tscript:alert(1)"],
    ["data:", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["data: com HTML", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["http:", "http://instagram.com/maria"],
    ["ftp:", "ftp://exemplo.org/arquivo"],
    ["usuário/senha na URL", "https://usuario:senha@instagram.com/maria"],
    ["domínio disfarçado de usuário", "https://instagram.com@golpe.example/maria"],
    ["porta", "https://instagram.com:8443/maria"],
    ["IP", "https://192.168.0.1/painel"],
    ["IPv6", "https://[::1]/painel"],
    ["localhost", "https://localhost/x"],
    ["sem domínio", "https://"],
    ["<script> como texto", "<script>alert(1)</script>"],
    ["aspas para fugir do atributo", 'https://instagram.com/"onmouseover="alert(1)'],
    ["espaço no meio", "https://instagram.com/maria joana"],
    ["caractere de controle", "https://instagram.com/\u0000maria"],
    ["inversão de direção do texto (RLO)", "https://instagram.com/‮gnp.exe"],
    ["caractere de largura zero", "https://insta​gram.com/maria"],
    ["barra invertida", "https:\\\\golpe.example"],
    ["vazio", "   "],
  ])("recusa %s", (_name, raw) => {
    expect(normalizeSocialLink(raw)).toBeNull();
  });

  it("recusa link longo demais (nunca corta)", () => {
    const max = `https://rede.example/${"a".repeat(socialLinkMaxLength - "https://rede.example/".length)}`;
    expect(normalizeSocialLink(max)).toBe(max);
    expect(normalizeSocialLink(`${max}a`)).toBeNull();
    expect(normalizeSocialLink(`https://rede.example/${"a".repeat(5000)}`)).toBeNull();
  });

  it("domínio com letras de outro alfabeto (IDN) vira punycode: o disfarce fica à vista", () => {
    // "іnstagram.com" com "і" cirílico (U+0456) não é o instagram.com.
    const spoof = normalizeSocialLink("https://іnstagram.com/maria");
    expect(spoof).toBe("https://xn--nstagram-shh.com/maria");
    expect(socialLinkView(spoof!)?.text).toBe("xn--nstagram-shh.com/maria");
  });
});

describe("socialLinkView", () => {
  it("mostra domínio (sem www.) e caminho, como texto", () => {
    expect(socialLinkView("https://www.instagram.com/maria/")).toEqual({
      href: "https://www.instagram.com/maria/",
      text: "instagram.com/maria",
    });
    expect(socialLinkView("https://exemplo.org")).toEqual({ href: "https://exemplo.org/", text: "exemplo.org" });
  });

  it("valor guardado que não passa na regra não aparece", () => {
    expect(socialLinkView("javascript:alert(1)")).toBeNull();
    expect(socialLinkViews(["javascript:alert(1)", "https://a.example/x", "https://a.example/x", "data:,x"])).toEqual([
      { href: "https://a.example/x", text: "a.example/x" },
    ]);
  });
});

describe("SocialLinkList (o que vai para o HTML)", () => {
  const html = (links: string[], newTab?: boolean) =>
    renderToStaticMarkup(createElement(SocialLinkList, { links, label: "Redes", newTab }));

  it("rel noopener noreferrer nofollow; sem target por padrão", () => {
    const out = html(["https://instagram.com/maria"]);
    expect(socialLinkRel).toBe("noopener noreferrer nofollow");
    expect(out).toContain('href="https://instagram.com/maria"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).not.toContain("target=");
    expect(out).toContain(">instagram.com/maria</a>");
  });

  it("target=_blank só quando pedido, sempre com o mesmo rel", () => {
    const out = html(["https://instagram.com/maria"], true);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("javascript:, data: e <script> nunca viram href nem HTML", () => {
    const out = html([
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "<script>alert(1)</script>",
      "https://exemplo.org/<script>alert(1)</script>",
      'https://exemplo.org/"><img src=x onerror=alert(1)>',
    ]);
    expect(out).toBe("");
  });

  it("um <script> que chega codificado no caminho aparece como texto, não como tag", () => {
    const out = html(["https://exemplo.org/%3Cscript%3Ealert(1)%3C/script%3E"]);
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain(">exemplo.org/%3Cscript%3Ealert(1)%3C/script%3E</a>");
  });

  it("sem link válido, não desenha nada", () => {
    expect(html([])).toBe("");
    expect(html(["javascript:alert(1)"])).toBe("");
  });
});
