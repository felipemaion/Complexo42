// Guarda (27/11): o CSS NÃO vai embutido na página (experimental.inlineCss). Medido com Lighthouse no celular:
// embutido, o Next manda o mesmo CSS duas vezes (no <style> e de novo nos dados do React), a página inicial ia de
// 22 KB para 127 KB e o trabalho de estilo e layout subia de ~0,25 s para ~1,1 s (4 medições alternadas de cada,
// CPU calibrada). Para religar, medir de novo e registrar a medição aqui.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("velocidade da página", () => {
  it("não embute o CSS na página (duplicava o estilo e pesava no celular)", () => {
    // Arrange
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

    // Act
    const embutido = /inlineCss\s*:\s*true/.test(config);

    // Assert
    expect(embutido).toBe(false);
  });
});
