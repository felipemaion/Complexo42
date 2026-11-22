import Link from "next/link";
import { buttonClass, Tag } from "@/modules/ui";
import type { MissionListItem, MissionRun, MissionsText } from "../types";

type MissionCardProps = {
  readonly mission: MissionListItem;
  readonly run: MissionRun | undefined;
  readonly href: string;
  readonly text: MissionsText;
  /** Posição na lista (0, 1, 2…): aparece como [01], [02]… como na página de entrada. */
  readonly index?: number;
};

// Cartão da lista de missões: origem, modo e andamento sempre escritos (ADR 0006 §3).
export function MissionCard({ mission, run, href, text, index }: MissionCardProps) {
  const runStatus = run?.status === "active" ? "active" : run?.status === "completed" ? "completed" : "none";
  const statusTone = runStatus === "completed" ? "success" : runStatus === "active" ? "warning" : "neutral";
  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary motion-reduce:transform-none">
      {index !== undefined && (
        <span aria-hidden="true" className="c42-display text-lg tracking-widest text-primary">
          [{String(index + 1).padStart(2, "0")}]
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        <Tag>{text.origin[mission.origin]}</Tag>
        <Tag>{text.mode[mission.mode]}</Tag>
        <Tag tone={statusTone}>{text.runStatus[runStatus]}</Tag>
      </div>
      <h2 className="c42-display text-3xl text-ink">{mission.title}</h2>
      {mission.description && <p className="line-clamp-3 text-lg text-ink-muted">{mission.description}</p>}
      <p className="text-lg font-semibold text-ink">
        {mission.totalPoints} {text.pointsSuffix}
      </p>
      <Link href={href} className={`${buttonClass(runStatus === "active" ? "primary" : "secondary")} no-underline`}>
        {text.openLink}
      </Link>
    </article>
  );
}
