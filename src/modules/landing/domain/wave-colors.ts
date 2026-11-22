// Cores das ondas da entrada (22/11). O canvas não entende variável de CSS: as cores do tema
// (config/instance.ts → <html>) são lidas como texto e convertidas aqui. Puro e sem efeito colateral.

export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#d4a537" ou "#fff" → [r, g, b]; qualquer outra coisa → null. */
export function parseHexColor(value: string): Rgb | null {
  const match = HEX.exec(value.trim());
  if (!match?.[1]) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const channel = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

const clamp = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));

/** Multiplica cada canal (0,5 escurece pela metade; acima de 1 clareia), sem passar de 255. */
export function shade(color: Rgb, factor: number): Rgb {
  return [clamp(color[0] * factor), clamp(color[1] * factor), clamp(color[2] * factor)];
}

export function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}
