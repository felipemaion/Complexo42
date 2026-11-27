// A casa da própria pessoa na página dela (#203): nome, cor, descrição curta e o gráfico dos eixos da
// casa com as zonas. Sem casa nem resultado, o convite (o link para o questionário é o "Escolher sua casa" da página). Só apresentação: quem
// decide o que mostrar é domain/home-card.ts, e o totem nunca chega aqui (ADR 0014 §2).
import { SpiderChart, type ChartHouse } from "@/modules/questionnaire/components/spider-chart";
import type { InstanceConfig } from "@/modules/instance";
import type { OwnHouseCard } from "../server/own-house";

type Props = {
  card: OwnHouseCard;
  houses: readonly (ChartHouse & { description: string })[];
  text: InstanceConfig["houseSelection"];
};

export function OwnHouse({ card, houses, text }: Readonly<Props>) {
  if (card.kind === "invite") {
    return (
      <section aria-labelledby="own-house-title" className="flex flex-col gap-3" data-testid="own-house-invite">
        <h2 id="own-house-title" className="text-xl font-semibold">
          {text.acceptedTitle}
        </h2>
        <p className="text-lg">{text.inviteMessage}</p>
      </section>
    );
  }
  const house = houses.find((candidate) => candidate.id === card.houseId);
  if (!house) return null;
  return (
    <section aria-labelledby="own-house-title" className="flex flex-col gap-3" data-testid="own-house">
      <h2 id="own-house-title" className="text-xl font-semibold">
        {card.isAccepted ? text.acceptedTitle : text.suggestedTitle}
      </h2>
      <p className="flex items-center gap-2 text-2xl font-bold">
        <span aria-hidden="true" className="inline-block size-4 rounded-sm" style={{ background: `light-dark(${house.color.light}, ${house.color.dark})` }} />
        {house.name}
      </p>
      <p className="text-lg">{house.description}</p>
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
