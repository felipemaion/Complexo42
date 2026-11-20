import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import {
  MISSION_PUBLISH_PATH,
  type MissionErrorCode,
  readPendingReviews,
  readPublishableUnits,
  ReviewItem,
  sessionMissionClient,
} from "@/modules/missions";
import { buttonClass, Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { reviewSubmissionAction } from "./actions";

export const metadata: Metadata = { title: instance.missions.review.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const errorCodes: readonly MissionErrorCode[] = ["not_allowed", "invalid_evidence", "locked", "already_done", "unavailable", "failed"];

// Fila de validação da coordenação (ADR 0006 §4, #32). O banco já tira as entregas de quem
// participou (antifraude); esta tela só mostra e manda a decisão.
export default async function MissionReviewPage({ searchParams }: Props) {
  await requireUser();
  const text = instance.missions;
  const params = await searchParams;
  const client = await sessionMissionClient();
  const [reviews, units] = client ? await Promise.all([readPendingReviews(client), readPublishableUnits(client)]) : [[], []];
  const error = errorCodes.find((code) => code === params.erro);
  const done = params.ok === "approved" || params.ok === "rejected" ? text.review.done[params.ok] : null;
  return (
    <PageShell title={text.review.title} intro={text.review.intro} width="wide">
      {error && <Notice tone="error">{text.errors[error]}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {units.length > 0 && (
        <Link href={MISSION_PUBLISH_PATH} className={`${buttonClass("secondary")} no-underline`}>
          {text.publish.menuLink}
        </Link>
      )}
      {reviews.length === 0 ? (
        <Notice tone="info">{text.review.empty}</Notice>
      ) : (
        <ul className="flex flex-col gap-4">
          {reviews.map((review) => (
            <ReviewItem key={review.submissionId} review={review} text={text} reviewAction={reviewSubmissionAction} />
          ))}
        </ul>
      )}
      <Link href="/inicio" className="text-center text-lg">
        {instance.coordination.homeBackLink}
      </Link>
    </PageShell>
  );
}
