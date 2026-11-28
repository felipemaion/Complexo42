import type { Metadata } from "next";
import Link from "next/link";
import { instance } from "@config/instance";
import { COORDINATION_PATH } from "@/modules/access";
import { readTransferWindow, requireCoordinationScreen } from "@/modules/houses";
import { setTransferWindowAction } from "./actions";

export const metadata: Metadata = { title: instance.questionnaireCoordination.window.title };

const big =
  "block w-full rounded-xl border-2 border-current px-6 py-5 text-center text-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2";

// Janela de transferência de casa (#302, ADR 0016): só a coordenação nacional (os outros recebem 404).
// Sem datas nem duração: aberta ou fechada, até a nacional mudar. O banco confere quem muda e audita.
export default async function TransferWindowPage({ searchParams }: Readonly<{ searchParams: Promise<{ erro?: string }> }>) {
  const { client } = await requireCoordinationScreen("window");
  const query = await searchParams;
  const open = await readTransferWindow(client);
  const text = instance.questionnaireCoordination;
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.window.title}</h1>
      <p className="text-lg">{text.window.intro}</p>
      {query.erro && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-4 text-lg">
          {text.window.failed}
        </p>
      )}
      <p className="rounded-xl border-2 border-current p-4 text-xl font-semibold" data-testid="window-status" data-open={open ? "true" : "false"}>
        {open ? text.window.statusOpen : text.window.statusClosed}
      </p>
      <form action={setTransferWindowAction}>
        <input type="hidden" name="estado" value={open ? "fechada" : "aberta"} />
        <button type="submit" className={big}>
          {open ? text.window.closeButton : text.window.openButton}
        </button>
      </form>
      <Link href={COORDINATION_PATH} className="text-center text-lg underline">
        {text.backLink}
      </Link>
    </main>
  );
}
