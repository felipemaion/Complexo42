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
// Ordem de leitura (revisor 22/11): número e estado, o título, e só depois as categorias (em texto,
// sem desenho, para não parecerem estado). A descrição vai inteira: o prazo costuma estar no fim.
export function MissionCard({ mission, run, href, text, index }: MissionCardProps) {
  const runStatus = run?.status === "active" ? "active" : run?.status === "completed" ? "completed" : "none";
  const statusTone = runStatus === "completed" ? "success" : runStatus === "active" ? "warning" : "primary";
  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary motion-reduce:transform-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {index !== undefined && (
          <span aria-hidden="true" className="c42-display text-lg tracking-widest text-primary">
            [{String(index + 1).padStart(2, "0")}]
          </span>
        )}
        <Tag tone={statusTone}>{text.runStatus[runStatus]}</Tag>
      </div>
      <h2 className="c42-display text-3xl text-ink">{mission.title}</h2>
      <p className="text-base text-ink-muted">
        {text.origin[mission.origin]} · {text.mode[mission.mode]}
      </p>
      {mission.description && <p className="text-lg text-ink-muted">{mission.description}</p>}
      <p className="text-lg font-semibold text-ink">
        {mission.totalPoints} {text.pointsSuffix}
      </p>
      <Link href={href} className={`${buttonClass(runStatus === "active" ? "primary" : "secondary")} no-underline`}>
        {text.openLink}
      </Link>
    </article>
  );
}
