// Gráfico de aranha do perfil (ADR 0014, #183), em SVG próprio, sem biblioteca. Os polos "a" de
// todos os eixos vêm primeiro e depois os polos "b": os opostos ficam frente a frente. Cada raio
// vale a intensidade do polo (0 a 100). Só apresentação: a geometria vem de domain/chart.ts.
import { chartSpokes, spokePoint, type ChartAxis } from "../domain/chart";

type Props = {
  axes: readonly ChartAxis[];
  /** Título lido pelo leitor de tela (ex.: "Seu perfil"). */
  title: string;
};

const size = 360;
// Margem dos lados: os nomes dos polos à esquerda e à direita cabem inteiros.
const sidePad = 90;
const center = { x: size / 2, y: size / 2 };
const radius = 120;
const labelRadius = radius + 26;
const gridSteps = [0.25, 0.5, 0.75, 1] as const;

const pointsOf = (points: readonly { x: number; y: number }[]) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export function SpiderChart({ axes, title }: Readonly<Props>) {
  const spokes = chartSpokes(axes);
  const count = spokes.length;
  // O gráfico é decorativo para o leitor de tela; a lista abaixo diz os mesmos números em texto.
  return (
    <figure className="flex flex-col items-center gap-2" data-testid="spider-chart">
      <svg viewBox={`${-sidePad} 0 ${size + 2 * sidePad} ${size}`} role="img" aria-label={title} className="w-full max-w-sm">
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
            <g key={`${spoke.side}-${spoke.label}`}>
              <line x1={center.x} y1={center.y} x2={end.x} y2={end.y} stroke="currentColor" strokeOpacity={0.25} />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.x < center.x - 8 ? "end" : label.x > center.x + 8 ? "start" : "middle"}
                dominantBaseline="middle"
                fontSize={14}
                fontWeight={700}
                fill={spoke.side === "a" ? "var(--color-primary)" : "var(--color-secondary)"}
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
        {spokes.map((spoke, index) => {
          const point = spokePoint(index, count, Math.max(3, (radius * spoke.intensity) / 100), center);
          return <circle key={`dot-${spoke.side}-${spoke.label}`} cx={point.x} cy={point.y} r={4} fill={spoke.side === "a" ? "var(--color-primary)" : "var(--color-secondary)"} />;
        })}
      </svg>
      <figcaption className="sr-only">
        <ul>
          {axes.map((axis) => (
            <li key={axis.key}>
              {axis.label}: {axis.score < 0 ? `${axis.poleA} ${-axis.score}` : axis.score > 0 ? `${axis.poleB} ${axis.score}` : `${axis.poleA} 0, ${axis.poleB} 0`}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
