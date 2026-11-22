import type { ReactNode } from "react";

type PageShellProps = {
  readonly title: string;
  readonly intro?: string;
  readonly width?: "narrow" | "wide";
  readonly children: ReactNode;
};

// Moldura de página de site: faixa de título na largura toda e conteúdo na largura do site.
// "wide" usa a largura do site (colunas no computador); "narrow" mantém formulários estreitos,
// alinhados com o título, como numa página de configurações.
export function PageShell({ title, intro, width = "narrow", children }: PageShellProps) {
  const contentWidth = width === "wide" ? "" : "max-w-2xl";

  return (
    <main className="flex w-full flex-col">
      <header className="border-b border-line bg-linear-to-br from-surface to-canvas">
        <div className="mx-auto flex w-full max-w-site flex-col gap-3 px-5 py-10">
          <span aria-hidden="true" className="h-1 w-14 rounded-full bg-primary" />
          <h1 className="c42-display text-4xl text-ink sm:text-5xl">{title}</h1>
          {intro && <p className="max-w-3xl text-lg text-ink-muted">{intro}</p>}
        </div>
      </header>
      <div className="mx-auto w-full max-w-site px-5 py-8">
        <div className={`flex w-full flex-col gap-6 ${contentWidth}`}>{children}</div>
      </div>
    </main>
  );
}
