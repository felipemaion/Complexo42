import type { ButtonVariant } from "../types";

// Base compartilhada para preservar alinhamento e área de toque mínima acessível
const baseClass =
  "min-h-14 px-6 py-3 rounded-xl text-xl font-bold inline-flex items-center justify-center gap-3 text-center border-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary border-primary",
  secondary: "bg-surface text-primary border-primary",
  quiet: "bg-transparent text-primary border-line",
  danger: "bg-surface text-danger border-danger",
};

export const inputClass =
  "w-full min-h-14 rounded-xl border-2 border-field bg-surface px-4 py-3 text-xl text-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-focus";

export const labelClass = "text-lg font-semibold text-ink";

export function buttonClass(
  variant: ButtonVariant,
  options?: { readonly isFullWidth?: boolean }
): string {
  const isFullWidth = options?.isFullWidth ?? true;
  const widthClass = isFullWidth ? "w-full" : "w-auto";

  return `${widthClass} ${baseClass} ${variantClasses[variant]}`;
}
