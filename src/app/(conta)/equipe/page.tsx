import Link from "next/link";
import {
  ChatPanel,
  readChat,
  readMyTeam,
  readTeamMates,
  readDraftState,
  readDraftOptions,
  DraftPickPanel,
  sessionCollabClient,
} from "@/modules/collab";
import { Card, Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { instance } from "@config/instance";
import { teamChatEnabled } from "@/modules/collab";
import { decryptField } from "@/server/crypto";
import { IdentityForm, readTeamIdentity, TeamFlag } from "@/modules/collab";
import { log } from "@/server/log";
import { pickInDraftAction, postMessageAction, saveIdentityAction } from "./actions";

export const metadata = {
  title: instance.myTeam.title,
};

type PageProps = {
  readonly searchParams: Promise<{
    readonly erro?: string;
    readonly ok?: string;
    readonly identidade?: string;
    readonly erro_identidade?: string;
  }>;
};

export default async function EquipePage(props: PageProps) {
  const user = await requireUser();
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

  // Draft do 2º ciclo: só aparece com rodada aberta que envolve a equipe (ata de 17/11 §6).
  const draft = await readDraftState(client);
  const draftOptions = draft?.isMyTurn
    ? await readDraftOptions(client, draft.sessionId, (v, profileId) =>
        decryptField(v, { table: "profiles", column: "display_name_enc", rowId: profileId }),
      )
    : [];
  const messages = teamChatEnabled()
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

  // Só códigos conhecidos viram mensagem; texto da URL nunca é exibido.
  const chatErrors = instance.teamChat.errors;
  const errorCode = Object.keys(chatErrors).find((key) => key === searchParams.erro) as keyof typeof chatErrors | undefined;
  const errorMessage = errorCode ? chatErrors[errorCode] : undefined;

  // Identidade da equipe (#56): todos da equipe veem; quem coordena a equipe edita (o banco decide).
  const idText = instance.teamIdentity;
  const identity = await readTeamIdentity(client, team.teamId).catch((error: unknown) => {
    log.warn("identity_read_failed", { error: error instanceof Error ? error.message : "unknown" });
    return null;
  });
  const canEditIdentity = mates.some((mate) => mate.isLead && mate.profileId === user.id);
  const identityError = (["not_allowed", "invalid", "failed"] as const).find((key) => key === searchParams.erro_identidade);

  return (
    <PageShell title={team.teamName} intro={instance.myTeam.title} width="wide">
      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
      {searchParams.identidade === "salva" && <Notice tone="success">{idText.saved}</Notice>}
      {identityError && <Notice tone="error">{idText.errors[identityError]}</Notice>}

      {identity && (
        <Card title={idText.title}>
          <div className="flex flex-wrap items-center gap-5">
            <TeamFlag identity={identity} label={`${idText.flagLabel}: ${team.teamName}`} />
            <p className="text-2xl font-bold text-primary">{identity.motto ?? idText.noIdentity}</p>
          </div>
          {canEditIdentity && (
            <details className="rounded-xl border border-line p-4">
              <summary className="cursor-pointer text-lg font-bold text-primary">{idText.editTitle}</summary>
              <div className="pt-4">
                <IdentityForm teamId={team.teamId} identity={identity} text={idText} saveAction={saveIdentityAction} />
              </div>
            </details>
          )}
        </Card>
      )}

      {/* No computador: quem está na equipe (e o draft) à esquerda, a conversa à direita. */}
      <div className="grid gap-8 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-5">
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

      {draft && (
        <Card title={instance.draft.title}>
          <DraftPickPanel state={draft} options={draftOptions} text={instance.draft} pickAction={pickInDraftAction} />
        </Card>
      )}
      </div>
      {teamChatEnabled() ? (
        <section className="flex flex-col gap-4 lg:col-span-7">
          <h2 className="text-2xl font-bold">{instance.teamChat.title}</h2>
          <ChatPanel
            teamId={team.teamId}
            messages={messages}
            text={instance.teamChat}
            postAction={postMessageAction}
          />
        </section>
      ) : null}
      </div>

      <Link href="/inicio" className="text-lg">
        {instance.coordination.homeBackLink}
      </Link>
    </PageShell>
  );
}
