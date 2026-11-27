import { Notice } from "@/modules/ui";
import type { InstanceConfig } from "@/modules/instance";
import type { DashboardRow } from "../types";

type DashboardListProps = {
  readonly rows: readonly DashboardRow[];
  readonly text: InstanceConfig["dashboard"];
};

export function DashboardList({ rows, text }: DashboardListProps) {
  if (rows.length === 0) {
    return <Notice tone="info">{text.empty}</Notice>;
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <div
          key={row.teamId}
          className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-3"
        >
          <h3 className="text-xl font-bold">{row.teamName}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <span className="text-base text-ink-muted">{text.membersLabel}</span>
              <span className="text-2xl font-bold text-primary">{row.memberCount}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-base text-ink-muted">{text.activeLabel}</span>
              <span className="text-2xl font-bold text-primary">{row.activeRuns}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-base text-ink-muted">{text.completedLabel}</span>
              <span className="text-2xl font-bold text-primary">{row.completedRuns}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-base text-ink-muted">{text.pointsLabel}</span>
              <span className="text-2xl font-bold text-primary">{row.teamPoints}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
