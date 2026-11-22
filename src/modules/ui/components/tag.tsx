import type { ReactNode } from "react";

export type TagTone = "neutral" | "primary" | "success" | "warning" | "danger";

type TagProps = {
  readonly tone?: TagTone;
  readonly children: ReactNode;
};

// O estado vem sempre escrito; a cor só reforça (WCAG 1.4.1: não depender só da cor). Desde 22/11
// cada tom tem também um desenho próprio (círculo vazio, ponto, relógio, visto, exclamação): dá
// para distinguir os estados até sem enxergar cor.
const toneClass: Record<TagTone, string> = {
  neutral: "bg-soft text-ink border-line",
  primary: "bg-soft text-primary border-primary",
  success: "bg-success-soft text-success border-success",
  warning: "bg-warning-soft text-warning border-warning",
  danger: "bg-danger-soft text-danger border-danger",
};

const toneIcon: Record<TagTone, ReactNode> = {
  neutral: <circle cx="8" cy="8" r="4.5" />,
  primary: <circle cx="8" cy="8" r="4" fill="currentColor" />,
  warning: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  success: <path d="M3.5 8.5l3 3 6-7" />,
  danger: <path d="M8 3.5v5.5M8 12v.5" />,
};

export function Tag({ tone = "neutral", children }: TagProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-base font-semibold ${toneClass[tone]}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {toneIcon[tone]}
      </svg>
      {children}
    </span>
  );
}
