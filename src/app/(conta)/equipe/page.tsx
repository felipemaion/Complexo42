import Link from "next/link";
import {
  ChatPanel,
  readChat,
  readMyTeam,
  readTeamMates,
  sessionCollabClient,
} from "@/modules/collab";
import { Card, Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { instance } from "@config/instance";
import { decryptField } from "@/server/crypto";
import { postMessageAction } from "./actions";

export const metadata = {
  title: instance.myTeam.title,
};

type PageProps = {
  readonly searchParams: Promise<{ readonly erro?: string; readonly ok?: string }>;
};

export default async function EquipePage(props: PageProps) {
  await requireUser();
  const searchParams = await props.searchParams;

  const client = await sessionCollabClient();
  if (!client) {
    return (
      <PageShell title={instance.myTeam.title}>
        <Notice tone="error">{instance.teamChat.errors.failed}</Notice>
      </PageShell>
    );
  }

  const team = await readMyTeam(client);
  if (!team) {
    return (
      <PageShell title={instance.myTeam.title}>
        <Notice tone="info">{instance.myTeam.noTeam}</Notice>
      </PageShell>
    );
  }

  const mates = await readTeamMates(client, team.teamId, (v, profileId) =>
    decryptField(v, {
      table: "profiles",
      column: "display_name_enc",
      rowId: profileId,
    }),
  );

  const messages = instance.teamChat.enabled
    ? await readChat(
        client,
        team.teamId,
        (v, profileId) =>
          decryptField(v, {
            table: "profiles",
            column: "display_name_enc",
            rowId: profileId,
          }),
        (v, teamId) =>
          decryptField(v, {
            table: "team_messages",
            column: "body_enc",
            rowId: teamId,
          }),
      )
    : [];

  const errorCode = searchParams.erro as keyof typeof instance.teamChat.errors | undefined;
  const errorMessage = errorCode ? instance.teamChat.errors[errorCode] : undefined;

  return (
    <PageShell title={team.teamName} intro={instance.myTeam.title}>
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}

      <Card title={instance.myTeam.membersTitle}>
        <ul className="flex flex-col gap-2">
          {mates.map((mate) => (
            <li key={mate.profileId} className="flex items-center justify-between">
              <span className="text-lg">{mate.displayName}</span>
              {mate.isLead ? (
                <Tag tone="success">{instance.myTeam.leadTag}</Tag>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {instance.teamChat.enabled ? (
        <section className="flex flex-col gap-4 mt-6">
          <h2 className="text-2xl font-bold">{instance.teamChat.title}</h2>
          <ChatPanel
            teamId={team.teamId}
            messages={messages}
            text={instance.teamChat}
            postAction={postMessageAction}
          />
        </section>
      ) : null}

      <Link href="/inicio" className="text-center text-lg mt-6">
        {instance.coordination.homeBackLink}
      </Link>
    </PageShell>
  );
}
