import type { Metadata, Viewport } from "next";
import { Archivo, Atkinson_Hyperlegible_Next, Fraunces } from "next/font/google";
import { connection } from "next/server";
import { instance } from "@config/instance";
import "./globals.css";

// Fonte desenhada para leitura com baixa visão (Braille Institute, licença OFL, grátis).
// O next/font baixa no build e serve do próprio app: sem chamada ao Google no navegador.
// Só o recorte "latin" (22/11): ele já tem tudo do português (ã, ç, õ, é…). Com "latin-ext" o site
// mandava baixar 6 arquivos (~340 KB) antes de mostrar a página; agora são os que a tela usa.
const bodyFont = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-body", display: "swap" });
// Assinatura "Cinema" (22/11): Archivo de largura variável nos títulos em caixa alta e Fraunces
// itálica na palavra de destaque (OFL, grátis, servidas pelo app como a de cima).
const displayFont = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
// A itálica só pinta uma palavra por título: chega depois, sem disputar o começo da página.
const accentFont = Fraunces({ subsets: ["latin"], style: ["italic"], variable: "--font-accent", display: "swap", preload: false });

// Nome, cores e textos da instância vêm de config/ (R17, ADR 0005).
export const metadata: Metadata = {
  title: { default: instance.name, template: `%s · ${instance.shortName}` },
  applicationName: instance.shortName,
  robots: { index: false, follow: false },
  // Ícone da aba: SVG gerado de config (src/app/favicon.ico/route.ts).
  icons: { icon: [{ url: "/favicon.ico", type: "image/svg+xml" }] },
};

// colorScheme "dark": o navegador já pinta a tela escura antes do CSS chegar (sem clarão branco na
// abertura "Cinema", achado no vídeo de 22/11).
export const viewport: Viewport = { themeColor: instance.colors.primary, colorScheme: "dark" };

// CSP com nonce (#152): o nonce nasce a cada requisição, então nenhuma página pode sair pronta do
// build (página estática não recebe nonce e teria os scripts bloqueados).
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const theme = {
    "--color-primary": instance.colors.primary,
    "--color-secondary": instance.colors.secondary,
  } as React.CSSProperties;
  return (
    <html lang="pt-BR" style={theme} className={`${bodyFont.variable} ${displayFont.variable} ${accentFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
