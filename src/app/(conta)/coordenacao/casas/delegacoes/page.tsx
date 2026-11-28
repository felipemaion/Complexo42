import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { listDelegationCandidates, listDelegations, requireCoordinationScreen } from "@/modules/houses";
import { errorText as lookupErrorText, shortDate } from "../format";
import { grantDelegationAction, revokeDelegationAction } from "./actions";
import { buttonClass, cardClass, fieldClass, noticeClass, PageShell, TableScroll, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.questionnaireCoordination.delegations.title };

const field = fieldClass();

// Delegações do acesso ao questionário (#174, ADR 0014): só a coordenação nacional (os outros
// recebem 404). Lista as concessões ativas e deixa conceder a um gestor de unidade abaixo da raiz ou revogar.
export default async function DelegationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ erro?: string; concedida?: string; revogada?: string }> }>) {
  const { client, deps } = await requireCoordinationScreen("delegations");
  const query = await searchParams;
  const [grants, candidates] = await Promise.all([listDelegations(client, deps), listDelegationCandidates(client, deps)]);
  const text = instance.questionnaireCoordination;
  const errorText = lookupErrorText(text.errors, query.erro);
  const notice = query.concedida === "1" ? text.delegations.grantedNotice : query.revogada === "1" ? text.delegations.revokedNotice : null;
  const alreadyGranted = new Set(grants.map((grant) => `${grant.granteeId}:${grant.unitId}`));
  const open = candidates.filter((candidate) => !alreadyGranted.has(`${candidate.granteeId}:${candidate.unitId}`));
  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.delegations.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.delegations.intro}</p>
      {notice && (
        <p role="status" className={noticeClass("info")}>
          {notice}
        </p>
      )}
      {errorText && (
        <p role="alert" className={noticeClass("error")}>
          {errorText}
        </p>
      )}
      <section className="flex flex-col gap-3" aria-labelledby="active-grants-title">
        <h2 id="active-grants-title" className="text-2xl font-bold">
          {text.delegations.activeTitle}
        </h2>
        {grants.length === 0 ? (
          <p className="text-lg">{text.delegations.empty}</p>
        ) : (
          <TableScroll label={text.delegations.title}>
          <table className="w-full text-left text-lg">
            <thead>
              <tr>
                <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.delegations.columnManager}</th>
                <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.delegations.columnUnit}</th>
                <th className="py-2 pr-4 text-base font-semibold text-ink-muted">{text.delegations.columnDate}</th>
                <th className="py-2 pr-4 text-base font-semibold text-ink-muted" />
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.grantId} className="border-t border-line" data-testid="grant-row">
                  <td className="py-2">{grant.granteeName ?? text.noName}</td>
                  <td className="py-2">{grant.unitName}</td>
                  <td className="py-2">{shortDate(grant.grantedAt)}</td>
                  <td className="py-2 text-right">
                    <form action={revokeDelegationAction}>
                      <input type="hidden" name="concessao" value={grant.grantId} />
                      <button type="submit" className={textLinkClass()}>
                        {text.delegations.revokeButton}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableScroll>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="new-grant-title">
        <h2 id="new-grant-title" className="text-2xl font-bold">
          {text.delegations.grantTitle}
        </h2>
        {open.length === 0 ? (
          <p className="text-lg">{text.delegations.noCandidates}</p>
        ) : (
          <form action={grantDelegationAction} className={cardClass()}>
            <label className="flex flex-col gap-1 text-lg font-semibold">
              {text.delegations.managerLabel}
              <select name="gestor" required defaultValue="" className={field}>
                <option value="" disabled />
                {open.map((candidate) => (
                  <option key={`${candidate.granteeId}:${candidate.unitId}`} value={`${candidate.granteeId}:${candidate.unitId}`}>
                    {(candidate.granteeName ?? text.noName) + " — " + candidate.unitName}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClass("primary", "lg")}>
              {text.delegations.grantButton}
            </button>
          </form>
        )}
      </section>
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
