import { buttonClass, inputClass, labelClass, Tag } from "@/modules/ui";
import type { MissionsText, PendingReview } from "../types";

type ReviewItemProps = {
  readonly review: PendingReview;
  readonly text: MissionsText;
  readonly reviewAction: (formData: FormData) => Promise<void>;
};

// Uma entrega para validar (ADR 0006 §4). Os dois botões ficam visíveis lado a lado; nada
// escondido em menu (ata de 17/11, §10). O link do comprovante abre em outra aba, sem `opener`.
export function ReviewItem({ review, text, reviewAction }: ReviewItemProps) {
  const noteId = `comentario-${review.submissionId}`;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap gap-2">
        <Tag>
          {text.review.unitLabel}: {review.unitName}
        </Tag>
        <Tag tone="primary">
          {review.stepPoints} {text.pointsSuffix}
        </Tag>
      </div>
      <h2 className="text-xl font-bold text-ink">{review.missionTitle}</h2>
      <p className="text-lg text-ink">{review.stepTitle}</p>
      <div className="rounded-xl bg-soft p-4 text-lg">
        <p className="font-semibold">{text.review.evidenceLabel}</p>
        {review.evidenceUrl && (
          <a href={review.evidenceUrl} target="_blank" rel="noopener noreferrer" className="break-all">
            {review.evidenceUrl}
          </a>
        )}
        {review.evidenceText && <p className="whitespace-pre-line break-words">{review.evidenceText}</p>}
        {!review.evidenceUrl && !review.evidenceText && <p className="text-ink-muted">{text.review.noEvidence}</p>}
      </div>
      <form action={reviewAction} className="flex flex-col gap-3">
        <input type="hidden" name="submissionId" value={review.submissionId} />
        <label htmlFor={noteId} className={labelClass}>
          {text.review.noteLabel}
        </label>
        <textarea id={noteId} name="note" maxLength={500} rows={2} className={`${inputClass} min-h-20`} />
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="submit" name="decision" value="approve" className={buttonClass("primary")}>
            {text.review.approveButton}
          </button>
          <button type="submit" name="decision" value="reject" className={buttonClass("danger")}>
            {text.review.rejectButton}
          </button>
        </div>
      </form>
    </li>
  );
}
