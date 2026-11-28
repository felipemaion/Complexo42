import { describe, expect, it } from "vitest";
import { buttonClass, fieldClass, noticeClass, pageContainerClass, textLinkClass } from "./styles";

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

  it("campos e links de ação também têm alvo de toque de 44 px", () => {
    expect(fieldClass()).toContain("min-h-target");
    expect(textLinkClass()).toContain("min-h-target");
  });

  it("o aviso de erro usa o tom de perigo e mantém o texto na cor de leitura", () => {
    expect(noticeClass("error")).toContain("border-danger");
    expect(noticeClass("error")).toContain("text-ink");
    expect(noticeClass("success")).toContain("border-success");
  });
});
