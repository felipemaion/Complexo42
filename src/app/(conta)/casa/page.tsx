import type { Metadata } from "next";
import { instance } from "@config/instance";
import { getQuestionnaire, HouseFlow, HousePresentation, readAcceptedHouse, sessionHouseClient } from "@/modules/houses";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: instance.houseSelection.title };

// Escolha da casa (#76, ADR 0008 §2). Quem já aceitou vê a sua casa; quem não, o fluxo. O
// questionário é lido no servidor (QUESTIONNAIRE_PATH ou o exemplo) e vai para a tela como
// dado; a pontuação acontece no aparelho.
export default async function HousePage() {
  const user = await requireUser();
  const text = instance.houseSelection;
  const houseIds = instance.houses.map((h) => h.id);
  const client = await sessionHouseClient();
  const accepted = client ? await readAcceptedHouse(client, user.id, houseIds) : null;
  const house = instance.houses.find((h) => h.id === accepted);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6 pt-10">
      <h1 className="text-3xl font-bold">{text.title}</h1>
      {house ? (
        <HousePresentation
          house={house}
          title={text.acceptedTitle}
          firstStepsTitle={text.firstStepsTitle}
          videosTitle={text.videosTitle}
        />
      ) : (
        <HouseFlow houses={instance.houses} questionnaire={getQuestionnaire()} text={text} />
      )}
    </main>
  );
}
