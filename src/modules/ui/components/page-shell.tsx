import type { ReactNode } from "react";

type PageShellProps = {
  readonly title: string;
  readonly intro?: string;
  readonly width?: "narrow" | "wide";
  readonly children: ReactNode;
};

export function PageShell({
  title,
  intro,
  width = "narrow",
  children,
}: PageShellProps) {
  const widthClass = width === "wide" ? "max-w-3xl" : "max-w-md";

  return (
    <main className={`mx-auto flex w-full flex-col gap-6 px-5 py-8 ${widthClass}`}>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold leading-tight text-ink">{title}</h1>
        {intro && <p className="text-lg text-ink-muted">{intro}</p>}
      </header>
      {children}
    </main>
  );
}
