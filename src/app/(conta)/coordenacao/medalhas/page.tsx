import Link from "next/link";
import type { Metadata } from "next";
import { instance } from "@config/instance";
import {
  CreateBadgeForm,
  GrantForm,
  readBadgeOptions,
  sessionBadgesClient,
} from "@/modules/badges";
import { listMissions, sessionMissionClient } from "@/modules/missions";
import { readMyTeams, readTeamMembers, readTeamParents } from "@/modules/teams";
import { Card, Notice, PageShell } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { createBadgeAction, grantBadgeAction } from "./actions";

export const metadata: Metadata = { title: instance.badges.title };

const doneKeys = ["created", "granted"] as const;
const errorKeys = ["not_allowed", "invalid", "already_has", "already_revoked", "failed"] as const;

type PageProps = {
  readonly searchParams: Promise<{
    readonly ok?: string;
    readonly erro?: string;
  }>;
};

export default async function BadgesCoordinationPage({ searchParams }: PageProps) {
  await requireUser();
  const text = instance.badges;
  const client = await sessionBadgesClient();

  if (!client) {
    return (
      <PageShell title={text.title}>
        <Notice tone="error">{text.errors.failed}</Notice>
      </PageShell>
    );
  }

  const scopes = await readTeamParents(client);
  // Missões que podem dar medalha automática ao serem concluídas (#36).
  const missionClient = await sessionMissionClient();
  const missions = missionClient ? await listMissions(missionClient) : [];
  if (scopes.length === 0) {
    return (
      <PageShell title={text.title}>
        <Notice tone="warning">{text.errors.not_allowed}</Notice>
      </PageShell>
    );
  }

  const { ok, erro } = await searchParams;

  // Só chaves conhecidas viram mensagem; texto da URL nunca é exibido nem usado como chave solta.
  const okKey = doneKeys.find((key) => key === ok);
  const errorKey = errorKeys.find((key) => key === erro);

  const [badges, myTeams] = await Promise.all([
    readBadgeOptions(client),
    readMyTeams(client),
  ]);

  const teamMembersLists = await Promise.all(
    myTeams.map((team) =>
      readTeamMembers(client, team.id, async (val, profileId) =>
        decryptField(val, {
          table: "profiles",
          column: "display_name_enc",
          rowId: profileId,
        }),
      ),
    ),
  );

  const peopleMap = new Map<string, string>();
  for (const members of teamMembersLists) {
    for (const member of members) {
      if (!peopleMap.has(member.profileId)) {
        peopleMap.set(member.profileId, member.displayName);
      }
    }
  }

  const people = Array.from(peopleMap.entries()).map(([profileId, displayName]) => ({
    profileId,
    displayName,
  }));

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {okKey && <Notice tone="success">{text.done[okKey]}</Notice>}
      {errorKey && <Notice tone="error">{text.errors[errorKey]}</Notice>}
      {/* No computador: dar medalha e criar medalha lado a lado. */}
      <div className="grid gap-8 lg:grid-cols-2">
        <Card title={text.grantTitle}>
          <GrantForm badges={badges} people={people} text={text} grantAction={grantBadgeAction} />
        </Card>
        <Card title={text.createTitle}>
          <CreateBadgeForm scopes={scopes} missions={missions} text={text} createAction={createBadgeAction} />
        </Card>
      </div>
      <Link href="/inicio" className="text-lg">
        {instance.coordination.homeBackLink}
      </Link>
    </PageShell>
  );
}
