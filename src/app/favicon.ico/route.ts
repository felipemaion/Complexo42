import { instance } from "@config/instance";
import { faviconSvg } from "@/modules/ui/domain/favicon";
import { brandInitials } from "@/modules/ui/domain/initials";

// Ícone da aba (22/11): monograma da instância em SVG. Fica em /favicon.ico porque o proxy de login
// já deixa esse caminho passar (src/proxy.ts) e o navegador o pede sozinho. Texto em
// --color-on-primary (globals.css), que não é configurável por instância.
const ON_PRIMARY = "#0b0d12";
const ONE_DAY_SECONDS = 86_400;

export function GET(): Response {
  const svg = faviconSvg(brandInitials(instance.shortName), {
    background: instance.colors.primary,
    text: ON_PRIMARY,
    stripe: instance.colors.secondary,
  });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${ONE_DAY_SECONDS}`,
    },
  });
}
