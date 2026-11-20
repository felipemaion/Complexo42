import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { MISSION_REVIEW_PATH, PublishForm, readPublishableUnits, sessionMissionClient } from "@/modules/missions";
import { Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { publishMissionAction } from "../actions";

export const metadata: Metadata = { title: instance.missions.publish.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const publishErrors = ["invalid", "not_allowed", "failed"] as const;

// Publicar missão (ADR 0006 §3 e §5, #33): só aparece o formulário para quem tem unidade onde
// publicar. Esconder é conforto; quem recusa de verdade é `public.publish_mission` (R15).
export default async function PublishMissionPage({ searchParams }: Props) {
  await requireUser();
  const text = instance.missions;
  const params = await searchParams;
  const client = await sessionMissionClient();
  const units = client ? await readPublishableUnits(client) : [];
  const error = publishErrors.find((code) => code === params.erro);
  return (
    <PageShell title={text.publish.title} intro={text.publish.intro}>
      {error && <Notice tone="error">{text.publish.errors[error]}</Notice>}
      {units.length === 0 ? (
        <Notice tone="warning">{text.publish.errors.not_allowed}</Notice>
      ) : (
        <PublishForm units={units} text={text} publishAction={publishMissionAction} />
      )}
      <Link href={MISSION_REVIEW_PATH} className="text-center text-lg">
        {text.review.title}
      </Link>
    </PageShell>
  );
}
