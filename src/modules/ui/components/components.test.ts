import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./brand-mark";
import { Card } from "./card";
import { Notice } from "./notice";
import { PageShell } from "./page-shell";

describe("PageShell", () => {
  it("renderiza o título no elemento h1", () => {
    // Arrange
    const props = {
      title: "Página de Configuração",
      children: createElement("div", null, "Conteúdo"),
    };

    // Act
    const html = renderToStaticMarkup(createElement(PageShell, props));

    // Assert
    expect(html).toContain("<h1");
    expect(html).toContain("Página de Configuração");
  });

  it("omite elemento de introdução quando a prop intro está ausente", () => {
    // Arrange
    const props = {
      title: "Sem Introdução",
      children: createElement("div", null, "Conteúdo"),
    };

    // Act
    const html = renderToStaticMarkup(createElement(PageShell, props));

    // Assert
    expect(html).not.toContain("text-ink-muted");
  });
});

describe("Card", () => {
  it("renderiza o elemento de cabeçalho h2 apenas quando o título é fornecido", () => {
    // Arrange
    const withTitle = {
      title: "Dados do Perfil",
      children: createElement("span", null, "Item"),
    };
    const withoutTitle = {
      children: createElement("span", null, "Item"),
    };

    // Act
    const htmlWithTitle = renderToStaticMarkup(createElement(Card, withTitle));
    const htmlWithoutTitle = renderToStaticMarkup(createElement(Card, withoutTitle));

    // Assert
    expect(htmlWithTitle).toContain("<h2");
    expect(htmlWithTitle).toContain("Dados do Perfil");
    expect(htmlWithoutTitle).not.toContain("<h2");
  });
});

describe("Notice", () => {
  it("aplica role alert exclusivamente quando tone é error e role status nos demais tons", () => {
    // Arrange
    const errorNotice = { tone: "error" as const, children: "Falha crítica" };
    const infoNotice = { tone: "info" as const, children: "Informação" };

    // Act
    const errorHtml = renderToStaticMarkup(createElement(Notice, errorNotice));
    const infoHtml = renderToStaticMarkup(createElement(Notice, infoNotice));

    // Assert
    expect(errorHtml).toContain('role="alert"');
    expect(infoHtml).toContain('role="status"');
  });
});

describe("BrandMark", () => {
  it("renderiza as iniciais calculadas e elemento oculto para leitores de tela", () => {
    // Arrange
    const props = { shortName: "Complexo42" };

    // Act
    const html = renderToStaticMarkup(createElement(BrandMark, props));

    // Assert
    expect(html).toContain("C42");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("bg-secondary");
  });
});
