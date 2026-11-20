import type { InstanceConfig } from "@/modules/instance";
import { buttonClass, inputClass, labelClass } from "@/modules/ui";
import type { PendingProposal } from "../server/proposals";
import type { PublishableUnit } from "../types";

// Decisão sobre uma proposta de equipe (#57): ajustar pontos e escolher para quem vale, ou recusar
// com justificativa. Tudo à vista; o banco confere o escopo de novo.
type ProposalReviewProps = {
  readonly proposal: PendingProposal;
  readonly units: readonly PublishableUnit[];
  readonly text: InstanceConfig["proposals"];
  readonly decideAction: (formData: FormData) => Promise<void>;
};

export function ProposalReview({ proposal, units, text, decideAction }: ProposalReviewProps) {
  const parent = units.find((unit) => unit.id === proposal.parentId);
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-bold">{proposal.title}</h3>
        <p className="text-base text-ink-muted">
          {text.proposedBy} {proposal.teamName}
        </p>
        {proposal.description && <p className="text-lg">{proposal.description}</p>}
      </div>
      <form action={decideAction} className="flex flex-col gap-4">
        <input type="hidden" name="missionId" value={proposal.id} />
        <ol className="flex flex-col gap-3">
          {proposal.steps.map((step) => (
            <li key={step.position} className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-lg">
                {step.position}. {step.title}
              </span>
              <label className="flex items-center gap-2 text-lg">
                {text.pointsLabel}
                <input name="points" type="number" min={1} max={1000} required defaultValue={step.points} className="h-12 w-24 rounded-xl border-2 border-field bg-surface px-3 text-lg text-ink" />
              </label>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-1">
          <label htmlFor={`escopo-${proposal.id}`} className={labelClass}>
            {text.scopeLabel}
          </label>
          <select id={`escopo-${proposal.id}`} name="scopeUnitId" defaultValue="" className={inputClass}>
            <option value="">{text.scopeTeam}</option>
            {parent && <option value={parent.id}>{parent.name}</option>}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`nota-${proposal.id}`} className={labelClass}>
            {text.noteLabel}
          </label>
          <textarea id={`nota-${proposal.id}`} name="note" maxLength={300} rows={2} className={`${inputClass} min-h-20`} />
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" name="decision" value="approve" className={buttonClass("primary", { isFullWidth: false })}>
            {text.approveButton}
          </button>
          <button type="submit" name="decision" value="reject" formNoValidate className={buttonClass("danger", { isFullWidth: false })}>
            {text.rejectButton}
          </button>
        </div>
      </form>
    </li>
  );
}
