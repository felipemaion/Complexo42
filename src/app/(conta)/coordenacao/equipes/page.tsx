import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import {
  CreateTeamForm,
  readMyTeams,
  readTeamMembers,
  readTeamParents,
  readUnassigned,
  sessionTeamsClient,
  TeamCard,
} from "@/modules/teams";
import { DashboardList, EvaluationForm, readDashboard, sessionCollabClient } from "@/modules/collab";
import { Card, Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import {
  assignAction,
  createTeamAction,
  leadAction,
  removeAction,
} from "./actions";
import { evaluateAction } from "./evaluation-action";

export const metadata: Metadata = { title: instance.teams.title };

type SearchParams = Promise<{
  readonly ok?: string;
  readonly erro?: string;
}>;

type Props = {
  readonly searchParams: SearchParams;
};

const validDoneKeys = ["created", "assigned", "removed", "lead"] as const;
type ValidDoneKey = (typeof validDoneKeys)[number];

const validErrorKeys = ["not_allowed", "invalid", "failed"] as const;
type ValidErrorKey = (typeof validErrorKeys)[number];

function isDoneKey(value: string | undefined): value is ValidDoneKey {
  return typeof value === "string" && (validDoneKeys as readonly string[]).includes(value);
}

function isErrorKey(value: string | undefined): value is ValidErrorKey {
  return typeof value === "string" && (validErrorKeys as readonly string[]).includes(value);
}

export default async function EquipesPage({ searchParams }: Props) {
  await requireUser();
  const client = await sessionTeamsClient();
  const { ok, erro } = await searchParams;
  const text = instance.teams;
  if (!client) {
    // Sem Auth configurado: aviso na tela (redirecionar para cá mesmo daria laço infinito).
    return (
      <PageShell title={text.title}>
        <Notice tone="error">{text.errors.failed}</Notice>
      </PageShell>
    );
  }

  const parents = await readTeamParents(client);

  const doneNoticeMessage = isDoneKey(ok) ? text.done[ok] : null;
  const errorNoticeMessage = isErrorKey(erro) ? text.errors[erro] : null;

  if (parents.length === 0) {
    return (
      <PageShell title={text.title} intro={text.intro} width="wide">
        {doneNoticeMessage && <Notice tone="success">{doneNoticeMessage}</Notice>}
        {errorNoticeMessage && <Notice tone="error">{errorNoticeMessage}</Notice>}
        <Notice tone="warning">{text.errors.not_allowed}</Notice>
        <Link href="/inicio" className="text-ink-muted hover:underline">
          {instance.coordination.homeBackLink}
        </Link>
      </PageShell>
    );
  }

  const teams = await readMyTeams(client);

  const decrypt = (value: string, profileId: string): Promise<string> =>
    decryptField(value, {
      table: "profiles",
      column: "display_name_enc",
      rowId: profileId,
    });

  const detailedTeams = await Promise.all(
    teams.map(async (team) => {
      const [members, unassigned] = await Promise.all([
        readTeamMembers(client, team.id, decrypt),
        readUnassigned(client, team.parentId, decrypt),
      ]);
      return { team, members, unassigned };
    }),
  );

  const collabClient = await sessionCollabClient();
  const dashboard = collabClient ? await readDashboard(collabClient) : [];
  const evaluated = ok === "evaluated" ? instance.evaluations.done : null;

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {evaluated && <Notice tone="success">{evaluated}</Notice>}
      {doneNoticeMessage && <Notice tone="success">{doneNoticeMessage}</Notice>}
      {errorNoticeMessage && <Notice tone="error">{errorNoticeMessage}</Notice>}

      <Card title={text.createTitle}>
        <CreateTeamForm
          parents={parents}
          text={text}
          createAction={createTeamAction}
        />
      </Card>

      {/* Painel da coordenação (#49): números por equipe, sem ranking de pessoas. */}
      <section aria-labelledby="painel" className="flex flex-col gap-3">
        <h2 id="painel" className="text-2xl font-bold">
          {instance.dashboard.title}
        </h2>
        <DashboardList rows={dashboard} text={instance.dashboard} />
      </section>

      <h2 className="text-2xl font-bold">{text.listTitle}</h2>

      {detailedTeams.length === 0 ? (
        <Notice tone="info">{text.noTeams}</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          {detailedTeams.map(({ team, members, unassigned }) => (
            <TeamCard
              key={team.id}
              team={team}
              members={members}
              unassigned={unassigned}
              text={text}
              assignAction={assignAction}
              removeAction={removeAction}
              leadAction={leadAction}
            />
          ))}
        </div>
      )}

      {/* Avaliação reservada (ADR 0007 §4): só aparece se a instância ligar, depois do jurídico. */}
      {instance.evaluations.enabled && detailedTeams.length > 0 && (
        <Card title={instance.evaluations.title}>
          <ul className="flex flex-col gap-3">
            {detailedTeams.flatMap(({ members }) => members).map((member) => (
              <li key={member.profileId} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-lg">{member.displayName}</span>
                <EvaluationForm profileId={member.profileId} text={instance.evaluations} evaluateAction={evaluateAction} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Link href="/inicio" className="text-center text-lg">
        {instance.coordination.homeBackLink}
      </Link>
    </PageShell>
  );
}
