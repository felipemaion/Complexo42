// Ícone da aba (22/11): o mesmo monograma do cabeçalho (BrandMark), desenhado em SVG com as cores
// da instância. Puro: cor que não seja hexadecimal cai no padrão, e o texto é escapado.

export type FaviconColors = {
  readonly background: string;
  readonly text: string;
  readonly stripe: string;
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const safeColor = (value: string, fallback: string): string => (HEX.test(value) ? value : fallback);
const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function faviconSvg(initials: string, colors: FaviconColors): string {
  const background = safeColor(colors.background, "#d4a537");
  const text = safeColor(colors.text, "#0b0d12");
  const stripe = safeColor(colors.stripe, "#f2c14e");
  const isLong = initials.length > 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${background}"/>` +
    `<rect y="57" width="64" height="7" fill="${stripe}"/>` +
    `<text x="32" y="${isLong ? 40 : 43}" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="${isLong ? 26 : 34}" fill="${text}">${escapeXml(initials)}</text>` +
    `</svg>`
  );
}
