import Link from "next/link";
import { buttonClass, inputClass, labelClass, Notice, Tag } from "@/modules/ui";
import type { PersonOption, TeamMember, TeamsText, TeamSummary } from "../types";

type Props = {
  readonly team: TeamSummary;
  readonly members: readonly TeamMember[];
  readonly unassigned: readonly PersonOption[];
  readonly text: TeamsText;
  readonly assignAction: (formData: FormData) => Promise<void>;
  readonly removeAction: (formData: FormData) => Promise<void>;
  readonly leadAction: (formData: FormData) => Promise<void>;
  /** Mover para outra equipe (#47): as outras equipes que a coordenação monta. */
  readonly otherTeams?: readonly { readonly id: string; readonly name: string }[];
  readonly moveAction?: (formData: FormData) => Promise<void>;
  /** Texto do link para o histórico da pessoa (#69); sem ele, o link não aparece. */
  readonly historyLabel?: string;
};

export function TeamCard({
  team,
  members,
  unassigned,
  text,
  assignAction,
  removeAction,
  leadAction,
  otherTeams = [],
  moveAction,
  historyLabel,
}: Props) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold">{team.name}</h2>
        <p className="text-ink-muted">{team.parentName}</p>
      </div>

      <div>
        <Tag tone="neutral">{`${team.memberCount} ${text.membersSuffix}`}</Tag>
      </div>

      {members.length === 0 ? (
        <p className="text-ink-muted">{text.noMembers}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {members.map((member) => (
            <li
              key={member.profileId}
              className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{member.displayName}</span>
                {member.isLead && <Tag tone="success">{text.leadTag}</Tag>}
                {/* Histórico de equipes da pessoa (#69); o id vem do banco (uuid). */}
                {historyLabel && (
                  <Link href={`/coordenacao/historico/${member.profileId}`} className="text-base font-semibold">
                    {historyLabel}
                  </Link>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {!member.isLead && (
                  <form action={leadAction}>
                    <input type="hidden" name="teamId" value={team.id} />
                    <input type="hidden" name="profileId" value={member.profileId} />
                    <button
                      type="submit"
                      className={buttonClass("secondary", { isFullWidth: false })}
                    >
                      {text.makeLeadButton}
                    </button>
                  </form>
                )}

                <form action={removeAction}>
                  <input type="hidden" name="teamId" value={team.id} />
                  <input type="hidden" name="profileId" value={member.profileId} />
                  <button
                    type="submit"
                    className={buttonClass("danger", { isFullWidth: false })}
                  >
                    {text.removeButton}
                  </button>
                </form>

                {moveAction && otherTeams.length > 0 && (
                  <form action={moveAction} className="flex items-center gap-2">
                    <input type="hidden" name="fromTeamId" value={team.id} />
                    <input type="hidden" name="profileId" value={member.profileId} />
                    <label className="sr-only" htmlFor={`mover-${team.id}-${member.profileId}`}>
                      {text.moveLabel}
                    </label>
                    <select
                      id={`mover-${team.id}-${member.profileId}`}
                      name="toTeamId"
                      required
                      defaultValue=""
                      className="min-h-12 rounded-xl border-2 border-field bg-surface px-3 text-lg text-ink"
                    >
                      <option value="" disabled>
                        {text.moveLabel}
                      </option>
                      {otherTeams.map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={buttonClass("quiet", { isFullWidth: false })}>
                      {text.moveButton}
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {unassigned.length === 0 ? (
        <Notice tone="info">{text.noUnassigned}</Notice>
      ) : (
        <form action={assignAction} className="flex flex-col gap-3">
          <label htmlFor={`assign-person-${team.id}`} className={labelClass}>
            {text.addLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              id={`assign-person-${team.id}`}
              name="profileId"
              className={inputClass}
              required
              defaultValue=""
            >
              <option value="" disabled>
                —
              </option>
              {unassigned.map((person) => (
                <option key={person.profileId} value={person.profileId}>
                  {person.displayName}
                </option>
              ))}
            </select>
            <input type="hidden" name="teamId" value={team.id} />
            <button
              type="submit"
              className={buttonClass("primary", { isFullWidth: false })}
            >
              {text.addButton}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
