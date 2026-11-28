import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { readTransferWindow, requireCoordinationScreen } from "@/modules/houses";
import { setTransferWindowAction } from "./actions";
import { buttonClass, noticeClass, PageShell, textLinkClass } from "@/modules/ui";

export const metadata: Metadata = { title: instance.questionnaireCoordination.window.title };

const big = buttonClass("primary", "lg");

// Janela de transferência de casa (#302, ADR 0016): só a coordenação nacional (os outros recebem 404).
// Sem datas nem duração: aberta ou fechada, até a nacional mudar. O banco confere quem muda e audita.
export default async function TransferWindowPage({ searchParams }: Readonly<{ searchParams: Promise<{ erro?: string }> }>) {
  const { client } = await requireCoordinationScreen("window");
  const query = await searchParams;
  const open = await readTransferWindow(client);
  const text = instance.questionnaireCoordination;
  return (
    <PageShell width="form">
      <h1 className="text-3xl font-bold sm:text-4xl">{text.window.title}</h1>
      <p className="max-w-prose text-lg text-ink-muted">{text.window.intro}</p>
      {query.erro && (
        <p role="alert" className={noticeClass("error")}>
          {text.window.failed}
        </p>
      )}
      <p className={`${noticeClass("info")} text-xl font-semibold`} data-testid="window-status" data-open={open ? "true" : "false"}>
        {open ? text.window.statusOpen : text.window.statusClosed}
      </p>
      <form action={setTransferWindowAction}>
        <input type="hidden" name="estado" value={open ? "fechada" : "aberta"} />
        <button type="submit" className={big}>
          {open ? text.window.closeButton : text.window.openButton}
        </button>
      </form>
      <Link href={COORDINATION_PATH} className={`${textLinkClass()} self-center`}>
        {text.backLink}
      </Link>
    </PageShell>
  );
}
