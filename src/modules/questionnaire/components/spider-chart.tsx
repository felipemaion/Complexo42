// Gráfico de aranha do perfil (ADR 0014, #183), em SVG próprio, sem biblioteca. Os polos "a" de
// todos os eixos vêm primeiro e depois os polos "b": os opostos ficam frente a frente. Cada raio
// vale a intensidade do polo (0 a 100). Com `houses`, desenha as zonas coloridas das casas (#201):
// o quadrante entre os polos dos eixos 1 e 2 que formam cada casa, com o nome dentro e a legenda.
// Só apresentação: a geometria vem de domain/chart.ts.
import { chartSpokes, houseZones, spokePoint, type ChartAxis } from "../domain/chart";
import type { HouseByPoles } from "../domain/chart";

/** Uma casa na legenda e nas zonas: cor clara e escura (CSS `light-dark()`, segue o tema do aparelho). */
export type ChartHouse = { id: string; name: string; color: { light: string; dark: string } };

export type ChartHouses = {
  /** Mapa polos → casa da config da instância; define qual quadrante é de qual casa. */
  byPoles: HouseByPoles;
  houses: readonly ChartHouse[];
  /** A casa da pessoa: zona e legenda em destaque. Sem ela (caso em análise), nenhuma destaca. */
  currentHouseId?: string;
  /** Texto do destaque na legenda (ex.: "sua casa"), da config. */
  currentLabel: string;
};

type Props = {
  chart: readonly ChartAxis[];
  /** Título lido pelo leitor de tela (ex.: "Seu perfil"). */
  title: string;
  houses?: ChartHouses;
  /** Segundo perfil, tracejado (ex.: a média dos membros da casa que se compara), na mesma ordem de eixos. */
  compare?: { chart: readonly ChartAxis[]; label: string };
};

const size = 360;
// Margem dos lados: os nomes dos polos à esquerda e à direita cabem inteiros.
const sidePad = 90;
const center = { x: size / 2, y: size / 2 };
const radius = 120;
const labelRadius = radius + 26;
const zoneLabelRadius = radius * 0.74;
// Caixa do nome da casa: largura estimada pelo número de letras (fonte de 13px em negrito).
const labelCharWidth = 7.6;
const labelPadX = 7;
const labelHeight = 22;
const gridSteps = [0.25, 0.5, 0.75, 1] as const;
// Zona da casa da pessoa mais forte que as outras (como no protótipo aprovado).
const currentZoneOpacity = 0.3;
const otherZoneOpacity = 0.1;

const pointsOf = (points: readonly { x: number; y: number }[]) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const colorOf = (color: ChartHouse["color"]) => `light-dark(${color.light}, ${color.dark})`;

export function SpiderChart({ chart, title, houses, compare }: Readonly<Props>) {
  const spokes = chartSpokes(chart);
  const compareSpokes = compare ? chartSpokes(compare.chart) : [];
  const count = spokes.length;
  const zones = houses ? houseZones(spokes, houses.byPoles, { center, radius, labelRadius: zoneLabelRadius }) : [];
  const houseById = new Map(houses?.houses.map((house) => [house.id, house]));
  // O gráfico é decorativo para o leitor de tela; a lista abaixo diz os mesmos números em texto.
  return (
    <figure className="flex flex-col items-center gap-2" data-testid="spider-chart">
      <svg viewBox={`${-sidePad} 0 ${size + 2 * sidePad} ${size}`} role="img" aria-label={title} className="w-full max-w-xl">
        {zones.map((zone) => {
          const house = houseById.get(zone.houseId);
          if (!house) return null;
          const isCurrent = zone.houseId === houses?.currentHouseId;
          return (
            <g key={zone.polesKey} data-testid="house-zone" data-house={zone.houseId}>
              <path d={zone.path} style={{ fill: colorOf(house.color) }} fillOpacity={isCurrent ? currentZoneOpacity : otherZoneOpacity} />
            </g>
          );
        })}
        {gridSteps.map((step) => (
          <polygon
            key={step}
            points={pointsOf(spokes.map((_, index) => spokePoint(index, count, radius * step, center)))}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.25}
          />
        ))}
        {spokes.map((spoke, index) => {
          const end = spokePoint(index, count, radius, center);
          const label = spokePoint(index, count, labelRadius, center);
          return (
            <g key={`${spoke.side}-${spoke.axis}`}>
              <line x1={center.x} y1={center.y} x2={end.x} y2={end.y} stroke="currentColor" strokeOpacity={0.25} />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.x < center.x - 8 ? "end" : label.x > center.x + 8 ? "start" : "middle"}
                dominantBaseline="middle"
                fontSize={14}
                fontWeight={700}
                className={spoke.side === "a" ? "fill-primary-ink" : "fill-secondary-ink"}
              >
                {spoke.label}
              </text>
            </g>
          );
        })}
        <polygon
          points={pointsOf(spokes.map((spoke, index) => spokePoint(index, count, Math.max(3, (radius * spoke.intensity) / 100), center)))}
          fill="currentColor"
          fillOpacity={0.14}
          stroke="currentColor"
          strokeWidth={2}
        />
        {compare && (
          <polygon
            data-testid="compare-profile"
            points={pointsOf(compareSpokes.map((spoke, index) => spokePoint(index, count, Math.max(3, (radius * spoke.intensity) / 100), center)))}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="7 5"
          />
        )}
        {spokes.map((spoke, index) => {
          const point = spokePoint(index, count, Math.max(3, (radius * spoke.intensity) / 100), center);
          return <circle key={`dot-${spoke.side}-${spoke.axis}`} cx={point.x} cy={point.y} r={4} className={spoke.side === "a" ? "fill-primary-ink" : "fill-secondary-ink"} />;
        })}
        {/* Nomes das casas por último, por cima de tudo: o retângulo opaco (cor do fundo, borda na cor da casa) impede que as linhas passem pela palavra. */}
        {zones.map((zone) => {
          const house = houseById.get(zone.houseId);
          if (!house) return null;
          const width = house.name.length * labelCharWidth + 2 * labelPadX;
          return (
            <g key={`label-${zone.polesKey}`} data-testid="house-zone-label">
              <rect
                x={zone.label.x - width / 2}
                y={zone.label.y - labelHeight / 2}
                width={width}
                height={labelHeight}
                rx={labelHeight / 3}
                style={{ fill: "var(--c-surface)", stroke: colorOf(house.color) }}
                strokeWidth={1}
              />
              <text x={zone.label.x} y={zone.label.y} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700} fill="currentColor">
                {house.name}
              </text>
            </g>
          );
        })}
      </svg>
      {compare && (
        <p className="flex items-center gap-2 text-base" data-testid="compare-legend">
          <svg aria-hidden="true" width="32" height="6">
            <line x1="0" y1="3" x2="32" y2="3" stroke="currentColor" strokeWidth={2} strokeDasharray="7 5" />
          </svg>
          {compare.label}
        </p>
      )}
      {houses && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-base" data-testid="house-legend">
          {houses.houses.map((house) => {
            const isCurrent = house.id === houses.currentHouseId;
            return (
              <li key={house.id} className={`flex items-center gap-1.5 ${isCurrent ? "font-bold" : ""}`} data-current={isCurrent ? "true" : undefined}>
                <span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ background: colorOf(house.color) }} />
                {house.name}
                {isCurrent && ` · ${houses.currentLabel}`}
              </li>
            );
          })}
        </ul>
      )}
      <figcaption className="sr-only">
        {compare && (
          <p>
            {compare.label}:{" "}
            {compare.chart.map((axis) => `${axis.label}: ${axis.score < 0 ? `${axis.poleA} ${-axis.score}` : axis.score > 0 ? `${axis.poleB} ${axis.score}` : `${axis.poleA} 0, ${axis.poleB} 0`}`).join("; ")}
          </p>
        )}
        <ul>
          {chart.map((axis) => (
            <li key={axis.key}>
              {axis.label}: {axis.score < 0 ? `${axis.poleA} ${-axis.score}` : axis.score > 0 ? `${axis.poleB} ${axis.score}` : `${axis.poleA} 0, ${axis.poleB} 0`}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
