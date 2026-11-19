import type { Metadata, Viewport } from "next";
import { instance } from "@config/instance";
import "./globals.css";

// Nome, cores e textos da instância vêm de config/ (R17, ADR 0005).
export const metadata: Metadata = {
  title: { default: instance.name, template: `%s · ${instance.shortName}` },
  applicationName: instance.shortName,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: instance.colors.primary };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
