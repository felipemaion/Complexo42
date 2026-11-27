// Os links de detalhe abrem o resultado de alguém e isso é registrado: sem prefetch, para o
// navegador não "abrir" resultados que ninguém abriu (registro fantasma).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("links que abrem um resultado ou um caso", () => {
  it.each(["resultados/page.tsx", "analise/page.tsx"])("%s: prefetch desligado", (file) => {
    const source = readFileSync(`src/app/(conta)/coordenacao/casas/${file}`, "utf8");
    const detailLinks = [...source.matchAll(/<Link\s+href=\{`\/coordenacao\/casas\/[^`]*\$\{[^}]+\}`\}[^>]*>/g)].map((m) => m[0]);
    expect(detailLinks.length).toBeGreaterThan(0);
    for (const link of detailLinks) expect(link).toContain("prefetch={false}");
  });
});
