// Links de rede (#17): só https, normalizados, e o que aparece na tela é texto puro.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SocialLinkList } from "../components/social-links";
import {
  normalizeSocialLink,
  socialLinkMaxLength,
  socialLinkRel,
  socialLinkTextRestMax,
  socialLinkView,
  socialLinkViews,
} from "./social";

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

describe("normalizeSocialLink: formatos de URL que o navegador aceita (revisão de segurança)", () => {
  it.each([
    // Aceitos, mas o destino normalizado é o mesmo que a tela mostra: nada fica escondido.
    ["https: sem barras", "https:instagram.com", "https://instagram.com/"],
    ["barras demais", "https:////evil.com", "https://evil.com/"],
    ["sem esquema, com //", "//evil.com", "https://evil.com/"],
  ])("%s: vira o endereço que aparece", (_name, raw, href) => {
    expect(normalizeSocialLink(raw)).toBe(href);
    expect(socialLinkView(raw)?.href).toBe(href);
  });

  it.each([
    ["dois-pontos fullwidth", "https\uFF1A//instagram.com/maria"],
    ["porta sem esquema (vira esquema desconhecido)", "instagram.com:80"],
    ["host terminado em ponto", "https://a."],
    ["host começando com ponto", "https://.a.com"],
    ["host sem ponto", "https://com"],
    ["IPv4 em hexadecimal", "https://0x7f.1"],
    ["IPv4 em octal num número só", "https://017700000001"],
    ["IPv4 misto", "https://0x7f.0.0.1"],
    ["IPv4 com zero à esquerda", "https://1.2.3.04"],
  ])("recusa %s", (_name, raw) => {
    expect(normalizeSocialLink(raw)).toBeNull();
  });

  it("aspas e <> no caminho: o navegador aceitaria (codificando), só a lista FORBIDDEN barra", () => {
    for (const raw of ['https://instagram.com/a"b', "https://instagram.com/<b>", "https://instagram.com/a'b", "https://instagram.com/a`b"]) {
      expect(() => new URL(raw)).not.toThrow();
      expect(normalizeSocialLink(raw)).toBeNull();
    }
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

  it("a busca e o fragmento aparecem no texto (redirecionamento à vista), e continuam no href", () => {
    expect(socialLinkView("https://google.com/url?q=https://evil.example")).toEqual({
      href: "https://google.com/url?q=https://evil.example",
      text: "google.com/url?q=https://evil.example",
    });
    expect(socialLinkView("https://www.youtube.com/watch?v=abc123#t=30")).toEqual({
      href: "https://www.youtube.com/watch?v=abc123#t=30",
      text: "youtube.com/watch?v=abc123#t=30",
    });
    expect(socialLinkView("https://exemplo.org/?ref=x")?.text).toBe("exemplo.org?ref=x");
  });

  it("texto longo: o domínio fica inteiro e o resto é cortado com …; o href não é cortado", () => {
    const rest = `/url?q=https://evil.example/${"a".repeat(100)}`;
    const view = socialLinkView(`https://google.com${rest}`)!;
    expect(view.href).toBe(`https://google.com${rest}`);
    expect(view.text.startsWith("google.com/url?q=https://evil.example/")).toBe(true);
    expect(view.text.endsWith("…")).toBe(true);
    expect(view.text).toHaveLength("google.com".length + socialLinkTextRestMax);
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

  it("lista hostil salva (com e sem nova aba): só o https limpo vira <a>, sempre com o rel seguro", () => {
    const hostile = [
      "javascript:alert(document.cookie)",
      " JaVaScRiPt:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "<img src=x onerror=alert(1)>",
      'https://exemplo.org/" target="_self" onclick="alert(1)',
      "https://usuario:senha@golpe.example/",
      "https://0x7f.1/",
      "http://instagram.com/maria",
      "https://google.com/url?q=https://evil.example",
    ];
    for (const newTab of [false, true]) {
      const out = html(hostile, newTab);
      expect(out.match(/<a /g)).toHaveLength(1);
      expect(out).not.toMatch(/javascript:|vbscript:|data:|onerror|onclick|<img|senha|127\.0\.0\.1|http:\/\//i);
      expect(out).toContain('href="https://google.com/url?q=https://evil.example"');
      expect(out).toContain(">google.com/url?q=https://evil.example</a>");
      expect(out).toContain('rel="noopener noreferrer nofollow"');
      if (newTab) expect(out).toContain('target="_blank"');
      else expect(out).not.toContain("target=");
    }
  });

  it("sem link válido, não desenha nada", () => {
    expect(html([])).toBe("");
    expect(html(["javascript:alert(1)"])).toBe("");
  });
});
