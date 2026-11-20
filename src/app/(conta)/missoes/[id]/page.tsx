import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instance } from "@config/instance";
import {
  type MissionErrorCode,
  MISSIONS_PATH,
  readMission,
  readMyRuns,
  readSubmissions,
  sessionMissionClient,
  StepItem,
  stepProgress,
  totalPoints,
} from "@/modules/missions";
import { buttonClass, Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { startMissionAction, submitStepAction } from "../actions";

export const metadata: Metadata = { title: instance.missions.title };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const errorCodes: readonly MissionErrorCode[] = ["not_allowed", "invalid_evidence", "locked", "already_done", "unavailable", "failed"];

// Só códigos conhecidos viram mensagem; texto da URL nunca é exibido.
function feedback(params: Record<string, string | string[] | undefined>): { tone: "success" | "error"; key: string } | null {
  const error = errorCodes.find((code) => code === params.erro);
  if (error) return { tone: "error", key: error };
  if (params.ok === "started" || params.ok === "submitted" || params.ok === "published") return { tone: "success", key: params.ok };
  return null;
}

// Detalhe da missão (ADR 0006 §3, #31): explicação, etapas com o estado de cada uma e, quando a
// etapa está aberta, o formulário de entrega. Tudo à vista, uma etapa abaixo da outra.
export default async function MissionPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const text = instance.missions;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const client = await sessionMissionClient();
  if (!client) notFound();
  const found = await readMission(client, id);
  if (!found) notFound();
  const { mission, steps } = found;
  const run = (await readMyRuns(client, user.id)).get(mission.id);
  const isActive = run?.status === "active";
  const submissions = run ? await readSubmissions(client, run.id) : [];
  const progress = stepProgress(steps, submissions, isActive);
  const message = feedback(query);
  const successByKey: Record<string, string | null> = { started: null, submitted: text.submitted, published: text.publish.done };
  const successText = message ? (successByKey[message.key] ?? null) : null;
  return (
    <PageShell title={mission.title} intro={mission.description || undefined}>
      <div className="flex flex-wrap gap-2">
        <Tag>{text.origin[mission.origin]}</Tag>
        <Tag>{text.mode[mission.mode]}</Tag>
        <Tag tone="primary">
          {totalPoints(steps)} {text.pointsSuffix}
        </Tag>
        {run?.status === "completed" && <Tag tone="success">{text.runStatus.completed}</Tag>}
      </div>
      {message?.tone === "error" && <Notice tone="error">{text.errors[message.key as MissionErrorCode]}</Notice>}
      {message?.tone === "success" && successText && <Notice tone="success">{successText}</Notice>}
      {!run && (
        <form action={startMissionAction} className="flex flex-col gap-2">
          <input type="hidden" name="missionId" value={mission.id} />
          <button type="submit" className={buttonClass("primary")}>
            {text.startButton}
          </button>
          {mission.mode === "team" && <p className="text-base text-ink-muted">{text.startHint}</p>}
        </form>
      )}
      <section aria-labelledby="etapas" className="flex flex-col gap-3">
        <h2 id="etapas" className="text-2xl font-bold">
          {text.stepsTitle}
        </h2>
        <ol className="flex flex-col gap-4">
          {progress.map((item) => (
            <StepItem
              key={item.step.id}
              progress={item}
              missionId={mission.id}
              runId={isActive && run ? run.id : null}
              text={text}
              submitAction={submitStepAction}
            />
          ))}
        </ol>
      </section>
      <Link href={MISSIONS_PATH} className="text-center text-lg">
        {text.backLink}
      </Link>
    </PageShell>
  );
}
