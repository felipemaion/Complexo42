import type { ReactNode } from "react";
import type { NoticeTone } from "../types";
import { SoundCue } from "./sound-cue";

type NoticeProps = {
  readonly tone: NoticeTone;
  readonly children: ReactNode;
};

const toneStyles: Record<NoticeTone, string> = {
  info: "bg-soft border-primary",
  success: "bg-success-soft border-success",
  warning: "bg-warning-soft border-warning",
  error: "bg-danger-soft border-danger text-ink",
};

export function Notice({ tone, children }: NoticeProps) {
  // Erros interrompem fluxo e usam alert; notificações usam status
  const role = tone === "error" ? "alert" : "status";

  // Entrada curta (c42-surge, globals.css) e, se a pessoa ligou o som, um toque de acerto ou de erro.
  return (
    <p role={role} className={`c42-surge rounded-xl border-l-4 p-4 text-lg ${toneStyles[tone]}`}>
      {tone === "success" && <SoundCue kind="ok" />}
      {tone === "error" && <SoundCue kind="error" />}
      {children}
    </p>
  );
}
