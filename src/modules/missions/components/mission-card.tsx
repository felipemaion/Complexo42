import Link from "next/link";
import { buttonClass, Tag } from "@/modules/ui";
import type { MissionListItem, MissionRun, MissionsText } from "../types";

type MissionCardProps = {
  readonly mission: MissionListItem;
  readonly run: MissionRun | undefined;
  readonly href: string;
  readonly text: MissionsText;
};

// Cartão da lista de missões: origem, modo e andamento sempre escritos (ADR 0006 §3).
export function MissionCard({ mission, run, href, text }: MissionCardProps) {
  const runStatus = run?.status === "active" ? "active" : run?.status === "completed" ? "completed" : "none";
  const statusTone = runStatus === "completed" ? "success" : runStatus === "active" ? "primary" : "neutral";
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap gap-2">
        <Tag>{text.origin[mission.origin]}</Tag>
        <Tag>{text.mode[mission.mode]}</Tag>
        <Tag tone={statusTone}>{text.runStatus[runStatus]}</Tag>
      </div>
      <h2 className="text-2xl font-bold leading-snug text-ink">{mission.title}</h2>
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
