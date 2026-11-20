import type { InstanceConfig } from "@/modules/instance";
import { buttonClass, inputClass, labelClass, Notice, Tag } from "@/modules/ui";
import type { DraftOption, DraftState } from "../server/draft";

type DraftText = InstanceConfig["draft"];
type Action = (formData: FormData) => Promise<void>;

type CoordinatorProps = {
  readonly state: DraftState | null;
  readonly parentId: string | null;
  readonly teams: readonly { readonly id: string; readonly name: string }[];
  readonly text: DraftText;
  readonly openAction: Action;
  readonly closeAction: Action;
};

// Lado da coordenação (ata de 17/11 §6): abre o draft com a ordem das equipes como estão na
// lista (a coordenação ordena pela avaliação dos porta-vozes) e encerra quando quiser.
export function DraftCoordinatorPanel({ state, parentId, teams, text, openAction, closeAction }: CoordinatorProps) {
  if (state) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-lg">
          {text.onTurn}: <Tag tone="primary">{state.teamOnTurnName}</Tag>
        </p>
        <form action={closeAction}>
          <input type="hidden" name="sessionId" value={state.sessionId} />
          <button type="submit" className={buttonClass("danger", { isFullWidth: false })}>
            {text.closeButton}
          </button>
        </form>
      </div>
    );
  }
  if (!parentId || teams.length < 2) return <Notice tone="info">{text.needTwoTeams}</Notice>;
  return (
    <form action={openAction} className="flex flex-col gap-3">
      <p className="text-lg text-ink-muted">{text.intro}</p>
      <ol className="list-decimal pl-6 text-lg">
        {teams.map((team) => (
          <li key={team.id}>
            {team.name}
            <input type="hidden" name="teamIds" value={team.id} />
          </li>
        ))}
      </ol>
      <input type="hidden" name="parentId" value={parentId} />
      <label htmlFor="draft-trecho" className={labelClass}>
        {text.sliceLabel}
      </label>
      <select id="draft-trecho" name="sliceSize" defaultValue="3" className={inputClass}>
        {[2, 3, 5, 10].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button type="submit" className={buttonClass("primary")}>
        {text.openButton}
      </button>
    </form>
  );
}

type PickProps = {
  readonly state: DraftState;
  readonly options: readonly DraftOption[];
  readonly text: DraftText;
  readonly pickAction: Action;
};

// Lado do coordenador da equipe: na sua vez, escolhe uma pessoa do trecho; fora da vez, espera.
export function DraftPickPanel({ state, options, text, pickAction }: PickProps) {
  if (!state.isMyTurn) {
    return (
      <Notice tone="info">
        {text.waiting} {text.onTurn}: {state.teamOnTurnName}.
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-semibold">{text.yourTurn}</p>
      <ul className="flex flex-col gap-2">
        {options.map((option) => (
          <li key={option.profileId} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
            <span className="text-lg">{option.displayName}</span>
            <form action={pickAction}>
              <input type="hidden" name="sessionId" value={state.sessionId} />
              <input type="hidden" name="profileId" value={option.profileId} />
              <button type="submit" className={buttonClass("primary", { isFullWidth: false })}>
                {text.pickButton}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
