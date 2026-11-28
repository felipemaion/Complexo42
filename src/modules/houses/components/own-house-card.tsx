// A casa da própria pessoa na página dela (#203): nome, cor, descrição curta e o gráfico dos eixos da
// casa com as zonas. Sem casa nem resultado, o convite (o link para o questionário é o "Escolher sua casa" da página). Só apresentação: quem
// decide o que mostrar é domain/home-card.ts. O totem chega aqui só como código e nome, já decifrado no servidor (ADR 0014,
// revisão de 28/11: todo membro vê o totem; #303); com ele, a medalha fica ao lado do brasão.
import { SpiderChart, type ChartHouse } from "@/modules/questionnaire/components/spider-chart";
import type { InstanceConfig } from "@/modules/instance";
import { HouseHero } from "./house-shield";
import { ChosenHouseAndTotem } from "./totem-medal";
import type { OwnHouseCard } from "../server/own-house";

type Props = {
  card: OwnHouseCard;
  houses: readonly (ChartHouse & { description: string })[];
  text: InstanceConfig["houseSelection"];
  /** O totem da própria pessoa (código e nome), lido e decifrado no servidor; sem ele, só o brasão. */
  totem?: { code: string; name: string } | null;
};

export function OwnHouse({ card, houses, text, totem = null }: Readonly<Props>) {
  if (card.kind === "invite") {
    return (
      <section aria-labelledby="own-house-title" className="flex flex-col gap-3" data-testid="own-house-invite">
        <h2 id="own-house-title" className="text-xl font-bold">
          {text.acceptedTitle}
        </h2>
        <p className="text-lg">{text.inviteMessage}</p>
      </section>
    );
  }
  const house = houses.find((candidate) => candidate.id === card.houseId);
  if (!house) return null;
  return (
    <section aria-labelledby="own-house-title" className="flex flex-col gap-4" data-testid="own-house">
      <h2 id="own-house-title" className="text-xl font-bold">
        {card.isAccepted ? text.acceptedTitle : text.suggestedTitle}
      </h2>
      {totem ? (
        <ChosenHouseAndTotem houseId={house.id} houseName={house.name} totemCode={totem.code} totemName={totem.name} />
      ) : (
        <HouseHero houseId={house.id} name={house.name} />
      )}
      <p className="text-lg text-ink-muted">{house.description}</p>
      {card.chart && (
        <SpiderChart
          chart={card.chart}
          title={text.chartTitle}
          houses={{ byPoles: card.byPoles, houses, currentHouseId: card.houseId, currentLabel: text.chartCurrentHouse }}
        />
      )}
    </section>
  );
}
