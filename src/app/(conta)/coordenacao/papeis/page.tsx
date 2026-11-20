import type { Metadata } from "next";
import { instance } from "@config/instance";
import { DELEGABLE_ROLES, readMyTeams, readRolesInScope, readTeamMembers, sessionTeamsClient } from "@/modules/teams";
import { buttonClass, Card, inputClass, labelClass, Notice, PageShell, Tag } from "@/modules/ui";
import { requireUser } from "@/server/auth/session";
import { decryptField } from "@/server/crypto";
import { log } from "@/server/log";
import { grantRoleAction, revokeRoleAction } from "./actions";

export const metadata: Metadata = { title: instance.roles.title };

type Props = { readonly searchParams: Promise<{ readonly ok?: string; readonly erro?: string }> };

const decryptName = (value: string, profileId: string) =>
  decryptField(value, { table: "profiles", column: "display_name_enc", rowId: profileId });

// Delegar papéis pela tela (#22, ADR 0002): só nas equipes que a pessoa coordena; o banco confere
// o escopo (só para baixo, nunca a si mesmo) e registra cada concessão e revogação no audit_log.
export default async function RolesPage({ searchParams }: Props) {
  await requireUser();
  const text = instance.roles;
  const params = await searchParams;
  const client = await sessionTeamsClient();
  if (!client) {
    return (
      <PageShell title={text.title}>
        <Notice tone="error">{text.errors.failed}</Notice>
      </PageShell>
    );
  }
  const [roles, teams] = await Promise.all([
    readRolesInScope(client, decryptName).catch((error: unknown) => {
      log.warn("roles_read_failed", { error: error instanceof Error ? error.message : "unknown" });
      return [];
    }),
    readMyTeams(client),
  ]);
  const members = (await Promise.all(teams.map((team) => readTeamMembers(client, team.id, decryptName)))).flat();
  const people = [...new Map(members.map((member) => [member.profileId, member.displayName])).entries()];
  const done = params.ok === "granted" || params.ok === "revoked" ? text.done[params.ok] : null;
  const error = (["invalid", "not_allowed", "already", "failed"] as const).find((key) => key === params.erro);
  const roleLabel = (role: string) => instance.roleLabels[role as keyof typeof instance.roleLabels] ?? role;

  return (
    <PageShell title={text.title} intro={text.intro} width="wide">
      {done && <Notice tone="success">{done}</Notice>}
      {error && <Notice tone="error">{text.errors[error]}</Notice>}
      <div className="grid gap-8 lg:grid-cols-12">
        <section aria-labelledby="papeis-ativos" className="flex flex-col gap-4 lg:col-span-7">
          <h2 id="papeis-ativos" className="text-2xl font-bold">
            {text.listTitle}
          </h2>
          {roles.length === 0 ? (
            <p className="text-lg text-ink-muted">{text.empty}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {roles.map((role) => (
                <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
                  <span className="flex flex-col">
                    <span className="text-lg font-bold">{role.displayName}</span>
                    <span className="text-base text-ink-muted">{role.unitName}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Tag tone="primary">{roleLabel(role.role)}</Tag>
                    <form action={revokeRoleAction}>
                      <input type="hidden" name="assignmentId" value={role.id} />
                      <button type="submit" className={buttonClass("danger", { isFullWidth: false })}>
                        {text.revokeButton}
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="lg:col-span-5">
          <Card title={text.grantTitle}>
            <form action={grantRoleAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="profileId" className={labelClass}>
                  {text.personLabel}
                </label>
                <select id="profileId" name="profileId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    —
                  </option>
                  {people.map(([profileId, name]) => (
                    <option key={profileId} value={profileId}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="role" className={labelClass}>
                  {text.roleLabel}
                </label>
                <select id="role" name="role" required defaultValue="spokesperson" className={inputClass}>
                  {DELEGABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="unitId" className={labelClass}>
                  {text.unitLabel}
                </label>
                <select id="unitId" name="unitId" required className={inputClass}>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className={buttonClass("primary")}>
                {text.grantButton}
              </button>
            </form>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
