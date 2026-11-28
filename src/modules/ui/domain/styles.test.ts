import { describe, expect, it } from "vitest";
import { buttonClass, pageContainerClass } from "./styles";

describe("estilos comuns (#324)", () => {
  it("todo botão tem alvo de toque de pelo menos 44 px", () => {
    for (const variant of ["primary", "secondary", "danger"] as const) {
      expect(buttonClass(variant, "md")).toContain("min-h-target");
      expect(buttonClass(variant, "lg")).toContain("min-h-14");
    }
  });

  it("o botão principal usa a cor da marca com o texto que contrasta com ela", () => {
    expect(buttonClass("primary")).toContain("bg-primary");
    expect(buttonClass("primary")).toContain("text-on-primary");
  });

  it("cada tipo de página tem a sua largura máxima", () => {
    expect(pageContainerClass("form")).toContain("max-w-form");
    expect(pageContainerClass("content")).toContain("max-w-content");
    expect(pageContainerClass("wide")).toContain("max-w-site");
  });
});
