import type { Axis, Pole, QuestionnaireConfig } from "./schema";
import type { AxisScores } from "./score";

/*
 * Dados do gráfico de aranha (ADR 0014, #183). Puro: só geometria e rótulos; quem desenha é o
 * componente SVG. Os polos "a" de todos os eixos vêm primeiro e depois os polos "b", na mesma
 * ordem dos eixos: assim o polo "b" de cada eixo fica a meia volta (180°) do seu polo "a", e os
 * opostos ficam frente a frente. Cada raio vale a intensidade daquele polo (0 a 100).
 */

/** Um eixo no gráfico: o nome da dimensão, o dos polos e a nota (negativa é o polo "a"). */
export type ChartAxis = { key: Axis; label: string; poleA: string; poleB: string; score: number };

/** Um raio do gráfico: o eixo, o nome do polo, o lado e a intensidade de 0 a 100. */
export type ChartSpoke = { axis: Axis; label: string; side: Pole; intensity: number };

/** Eixos do gráfico, com nome e notas. `axes` escolhe quais (a pessoa vê só os da casa). */
export function chartAxes(config: QuestionnaireConfig, scores: AxisScores, axes: readonly Axis[]): ChartAxis[] {
  return axes.map((key) => ({
    key,
    label: config.axes[key].label,
    poleA: config.axes[key].poleLabels.a,
    poleB: config.axes[key].poleLabels.b,
    score: scores[key],
  }));
}

/** Raios do gráfico: todos os polos "a" e, em seguida, todos os polos "b". */
export function chartSpokes(axes: readonly ChartAxis[]): ChartSpoke[] {
  return [
    ...axes.map((axis): ChartSpoke => ({ axis: axis.key, label: axis.poleA, side: "a", intensity: Math.max(0, -axis.score) })),
    ...axes.map((axis): ChartSpoke => ({ axis: axis.key, label: axis.poleB, side: "b", intensity: Math.max(0, axis.score) })),
  ];
}

/**
 * Ordem da visão da coordenação (#201): os eixos 1, 3, 2, 4, de modo que os raios ficam a1, a3, a2, a4,
 * b1, b3, b2, b4. Os eixos da casa ficam a 90° entre si (as zonas das casas são os quadrantes entre
 * eles) e os do totem nas diagonais. Sem os quatro eixos (a pessoa vê só os da casa), nada muda.
 */
export function crossOrder(axes: readonly ChartAxis[]): ChartAxis[] {
  const byKey = new Map(axes.map((axis) => [axis.key, axis]));
  const crossKeys: readonly Axis[] = ["house1", "totem1", "house2", "totem2"];
  const crossed = crossKeys.map((key) => byKey.get(key));
  return crossed.every((axis) => axis !== undefined) ? crossed : [...axes];
}

/** Os polos dos eixos 1 e 2 que formam uma casa: `"ab"` é o polo a do eixo 1 com o polo b do eixo 2. */
export type PolesKey = `${Pole}${Pole}`;
export type HouseByPoles = Readonly<Record<PolesKey, string>>;

/** Uma zona colorida do gráfico: a casa, o quadrante (caminho SVG) e onde escrever o nome. */
export type HouseZone = { polesKey: PolesKey; houseId: string; path: string; label: { x: number; y: number } };

type Point = { x: number; y: number };
type SpokeRef = { axis: Axis; side: Pole };

/**
 * Os quatro quadrantes em volta do gráfico (sentido horário), cada um entre dois raios dos eixos da casa:
 * a1→a2 (a,a), a2→b1 (b,a), b1→b2 (b,b) e b2→a1 (a,b). `polesKey` é (polo do eixo 1)(polo do eixo 2).
 */
const zoneCorners: readonly { from: SpokeRef; to: SpokeRef; polesKey: PolesKey }[] = [
  { from: { axis: "house1", side: "a" }, to: { axis: "house2", side: "a" }, polesKey: "aa" },
  { from: { axis: "house2", side: "a" }, to: { axis: "house1", side: "b" }, polesKey: "ba" },
  { from: { axis: "house1", side: "b" }, to: { axis: "house2", side: "b" }, polesKey: "bb" },
  { from: { axis: "house2", side: "b" }, to: { axis: "house1", side: "a" }, polesKey: "ab" },
];

const roundedCoordinate = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * Zonas das casas (#201): o quadrante entre os raios dos eixos 1 e 2 que formam cada casa, segundo o
 * mapa `houseByPoles` da config (nunca fixo no código). Puro: só geometria. Sem os dois eixos da casa
 * entre os raios, não há zonas. `labelRadius` é a distância do centro onde fica o nome da casa.
 */
export function houseZones(
  spokes: readonly ChartSpoke[],
  houseByPoles: HouseByPoles,
  geometry: { center: Point; radius: number; labelRadius: number },
): HouseZone[] {
  const count = spokes.length;
  const indexOf = ({ axis, side }: SpokeRef) => spokes.findIndex((spoke) => spoke.axis === axis && spoke.side === side);
  const { center, radius, labelRadius } = geometry;
  const zones: HouseZone[] = [];
  for (const { from, to, polesKey } of zoneCorners) {
    const start = indexOf(from);
    const end = indexOf(to);
    if (start < 0 || end < 0) return [];
    const startPoint = spokePoint(start, count, radius, center);
    const endPoint = spokePoint(end, count, radius, center);
    const middle = start + ((end - start + count) % count) / 2;
    zones.push({
      polesKey,
      houseId: houseByPoles[polesKey],
      path: `M${center.x},${center.y} L${roundedCoordinate(startPoint.x)},${roundedCoordinate(startPoint.y)} A${radius},${radius} 0 0 1 ${roundedCoordinate(endPoint.x)},${roundedCoordinate(endPoint.y)} Z`,
      label: spokePoint(middle, count, labelRadius, center),
    });
  }
  return zones;
}

/** Ponto do raio `index` (de `count`) à distância `radius` do centro; o raio 0 aponta para cima. */
export function spokePoint(index: number, count: number, radius: number, center: { x: number; y: number }): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}
