import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { instance } from "@config/instance";
import "./globals.css";

// Nome, cores e textos da instância vêm de config/ (R17, ADR 0005).
export const metadata: Metadata = {
  title: { default: instance.name, template: `%s · ${instance.shortName}` },
  applicationName: instance.shortName,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: instance.colors.primary };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // CSP com nonce (#152): toda página é montada na hora. Página pronta no build não recebe o nonce da
  // requisição, e a CSP bloquearia os scripts dela (https://nextjs.org/docs/app/guides/content-security-policy).
  await connection();
  const theme = {
    "--color-primary": instance.colors.primary,
    "--color-secondary": instance.colors.secondary,
  } as React.CSSProperties;
  return (
    <html lang="pt-BR" style={theme}>
      <body className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
