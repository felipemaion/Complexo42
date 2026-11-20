import type { ReactNode } from "react";

export type TagTone = "neutral" | "primary" | "success" | "warning" | "danger";

type TagProps = {
  readonly tone?: TagTone;
  readonly children: ReactNode;
};

// O estado vem sempre escrito; a cor só reforça (WCAG 1.4.1: não depender só da cor).
const toneClass: Record<TagTone, string> = {
  neutral: "bg-soft text-ink border-line",
  primary: "bg-soft text-primary border-primary",
  success: "bg-success-soft text-success border-success",
  warning: "bg-warning-soft text-warning border-warning",
  danger: "bg-danger-soft text-danger border-danger",
};

export function Tag({ tone = "neutral", children }: TagProps) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-base font-semibold ${toneClass[tone]}`}>
      {children}
    </span>
  );
}
