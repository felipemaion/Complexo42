import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Nome e textos da instância virão de config/ (#54, R17).
  title: "Em construção",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
