import type { Metadata } from "next";
import { instance } from "@config/instance";
import { toPublicQuestionnaire } from "@/modules/questionnaire";
import Link from "next/link";
import { canChangeHouse, getQuestionnaire, HouseFlow, HousePresentation, houseLockNotice, readAcceptedHouse, readHouseLock, sessionHouseClient } from "@/modules/houses";
import { requireUserBeforeHouse } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.houseSelection.title };

// Escolha da casa (#76, ADR 0008 §2). Quem já aceitou vê a sua casa; quem não, o fluxo. O
// questionário é lido no servidor (QUESTIONNAIRE_PATH ou o exemplo) e vai para a tela só com as
// perguntas; a pontuação e a chave ficam no servidor (ADR 0014 §1).
export default async function HousePage({ searchParams }: Readonly<{ searchParams: Promise<{ trocar?: string }> }>) {
  const user = await requireUserBeforeHouse();
  const text = instance.houseSelection;
  const houseIds = instance.houses.map((h) => h.id);
  const client = await sessionHouseClient();
  const accepted = client ? await readAcceptedHouse(client, user.id, houseIds) : null;
  const house = instance.houses.find((h) => h.id === accepted);
  // Trava de 4 meses (ADR 0016): o banco decide; aqui só o aviso com a data e o caminho da troca, depois do prazo.
  const lockedUntil = client && house ? await readHouseLock(client, user.id) : null;
  const now = new Date();
  const lockNotice = houseLockNotice(text.lockedUntilNotice, lockedUntil, now);
  const changing = house !== undefined && (await searchParams).trocar === "1" && canChangeHouse(lockedUntil, now);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      {house && !changing ? (
        <>
          <HousePresentation
            house={house}
            title={text.acceptedTitle}
            firstStepsTitle={text.firstStepsTitle}
            videosTitle={text.videosTitle}
          />
          {lockNotice ? (
            <p className="text-lg font-semibold" data-testid="house-lock-notice">
              {lockNotice}
            </p>
          ) : (
            <Link href="/casa?trocar=1" className="text-center text-lg underline" data-testid="change-house-link">
              {text.changeHouseLink}
            </Link>
          )}
        </>
      ) : (
        <HouseFlow
          houses={instance.houses}
          questionnaire={toPublicQuestionnaire(getQuestionnaire())}
          text={text}
          startAtActivities={changing}
        />
      )}
    </main>
  );
}
