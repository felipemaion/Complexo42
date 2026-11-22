import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import { connection } from "next/server";
import { instance } from "@config/instance";
import "./globals.css";

// Fonte desenhada para leitura com baixa visão (Braille Institute, licença OFL, grátis).
// O next/font baixa no build e serve do próprio app: sem chamada ao Google no navegador.
const bodyFont = Atkinson_Hyperlegible_Next({ subsets: ["latin", "latin-ext"], variable: "--font-body", display: "swap" });

// Nome, cores e textos da instância vêm de config/ (R17, ADR 0005).
export const metadata: Metadata = {
  title: { default: instance.name, template: `%s · ${instance.shortName}` },
  applicationName: instance.shortName,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: instance.colors.primary };

// CSP com nonce (#152): o nonce nasce a cada requisição, então nenhuma página pode sair pronta do
// build (página estática não recebe nonce e teria os scripts bloqueados).
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const theme = {
    "--color-primary": instance.colors.primary,
    "--color-secondary": instance.colors.secondary,
  } as React.CSSProperties;
  return (
    <html lang="pt-BR" style={theme} className={bodyFont.variable}>
      <body>{children}</body>
    </html>
  );
}
