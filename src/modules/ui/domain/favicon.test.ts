import { describe, expect, it } from "vitest";
import { faviconSvg } from "./favicon";

describe("ícone da aba", () => {
  it("desenha as iniciais com as cores da instância", () => {
    // Act
    const svg = faviconSvg("C42", { background: "#d4a537", text: "#0b0d12", stripe: "#f2c14e" });

    // Assert
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#d4a537"');
    expect(svg).toContain('fill="#0b0d12"');
    expect(svg).toContain('fill="#f2c14e"');
    expect(svg).toContain(">C42</text>");
  });

  it("escapa o texto e recusa cor que não seja hexadecimal (nada de SVG injetado)", () => {
    // Act
    const svg = faviconSvg("<&>", { background: 'red" onload="x', text: "#000", stripe: "#fff" });

    // Assert
    expect(svg).toContain(">&lt;&amp;&gt;</text>");
    expect(svg).not.toContain("onload");
  });
});
