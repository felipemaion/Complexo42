import type { ReactNode } from "react";

type CardProps = {
  readonly title?: string;
  readonly children: ReactNode;
};

export function Card({ title, children }: CardProps) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      {title && <h2 className="text-2xl font-bold">{title}</h2>}
      {children}
    </section>
  );
}
