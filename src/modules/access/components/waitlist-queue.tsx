// Fila de espera da coordenação (#26). Só apresentação, sem JavaScript no navegador: "Liberar"
// e "Bloquear" são links que abrem a confirmação na própria linha; só o "Sim" envia o
// formulário para a server action. Mostra nome, cidade e data do cadastro, nunca e-mail.
import Link from "next/link";
import {
  DECISION_FIELD,
  DECISION_PROFILE_FIELD,
  WAITLIST_PARAMS,
  fillText,
  waitlistHref,
  type DecisionWord,
} from "../domain/coordination";
import type { WaitlistCursor } from "../types";
import { buttonClass, cardClass, noticeClass, textLinkClass } from "@/modules/ui";

export type WaitlistQueueText = {
  empty: string;
  since: string;
  place: string;
  approveButton: string;
  blockButton: string;
  confirmApprove: string;
  confirmBlock: string;
  confirmApproveButton: string;
  confirmBlockButton: string;
  cancelButton: string;
  unknownNameNote: string;
  nextPage: string;
  firstPage: string;
};

export type WaitlistQueueEntry = {
  profileId: string;
  /** Nome para exibir (ou o texto de nome ilegível). */
  displayName: string;
  /** False quando o nome não decifrou: sem saber quem é, não dá para liberar. */
  isIdentified: boolean;
  /** Cidade e UF já montadas para exibir. */
  place: string;
  /** Data do cadastro já formatada. */
  since: string;
};

type Props = {
  entries: readonly WaitlistQueueEntry[];
  /** Posição atual (para manter a página ao confirmar ou cancelar). */
  cursor?: WaitlistCursor;
  nextCursor: WaitlistCursor | null;
  confirmation: { profileId: string; word: DecisionWord } | null;
  action: (formData: FormData) => Promise<void>;
  text: WaitlistQueueText;
};

const big = buttonClass("secondary", "lg");

export function WaitlistQueue({ entries, cursor, nextCursor, confirmation, action, text }: Props) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className={noticeClass("info")}>{text.empty}</p>
        {cursor && (
          <Link href={waitlistHref()} className={big}>
            {text.firstPage}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {/* Em grade no computador (#324): a coordenação vê várias pessoas de uma vez. */}
      <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => {
          const requested = confirmation?.profileId === entry.profileId ? confirmation.word : null;
          // Liberar exige saber quem é; um pedido de confirmação pela URL também não passa.
          const confirming = requested === "liberar" && !entry.isIdentified ? null : requested;
          return (
            <li key={entry.profileId} className={cardClass()} data-testid="waitlist-entry">
              <p className="text-2xl font-bold">{entry.displayName}</p>
              <p className="text-lg">{entry.place}</p>
              <p className="text-base text-ink-muted">{fillText(text.since, { date: entry.since })}</p>
              {!entry.isIdentified && (
                <p className="rounded-lg border-2 border-current p-3 text-lg" data-testid="waitlist-unknown-name">
                  {text.unknownNameNote}
                </p>
              )}
              {confirming ? (
                <form action={action} className="flex flex-col gap-3" role="group" aria-label={entry.displayName}>
                  <p className="text-lg font-semibold" role="alert">
                    {fillText(confirming === "liberar" ? text.confirmApprove : text.confirmBlock, { name: entry.displayName })}
                  </p>
                  <input type="hidden" name={DECISION_PROFILE_FIELD} value={entry.profileId} />
                  <input type="hidden" name={DECISION_FIELD} value={confirming} />
                  <button type="submit" className={buttonClass(confirming === "liberar" ? "primary" : "danger", "lg")}>
                    {confirming === "liberar" ? text.confirmApproveButton : text.confirmBlockButton}
                  </button>
                  <Link href={waitlistHref(cursor)} className={big}>
                    {text.cancelButton}
                  </Link>
                </form>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {entry.isIdentified ? (
                    <Link
                      href={waitlistHref(cursor, {
                        [WAITLIST_PARAMS.confirm]: entry.profileId,
                        [WAITLIST_PARAMS.confirmDecision]: "liberar",
                      })}
                      className={big}
                      aria-label={`${text.approveButton}: ${entry.displayName}`}
                    >
                      {text.approveButton}
                    </Link>
                  ) : (
                    <button type="button" disabled className={big}>
                      {text.approveButton}
                    </button>
                  )}
                  <Link
                    href={waitlistHref(cursor, {
                      [WAITLIST_PARAMS.confirm]: entry.profileId,
                      [WAITLIST_PARAMS.confirmDecision]: "bloquear",
                    })}
                    className={big}
                    aria-label={`${text.blockButton}: ${entry.displayName}`}
                  >
                    {text.blockButton}
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {nextCursor && (
        <Link href={waitlistHref(nextCursor)} className={big}>
          {text.nextPage}
        </Link>
      )}
      {cursor && (
        <Link href={waitlistHref()} className={`${textLinkClass()} self-center`}>
          {text.firstPage}
        </Link>
      )}
    </div>
  );
}
