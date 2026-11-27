import type { Axis, QuestionnaireConfig } from "./schema";
import type { AxisScores } from "./score";

/*
 * Dados do gráfico de aranha (ADR 0014, #183). Puro: só geometria e rótulos; quem desenha é o
 * componente SVG. Os polos "a" de todos os eixos vêm primeiro e depois os polos "b", na mesma
 * ordem dos eixos: assim o polo "b" de cada eixo fica a meia volta (180°) do seu polo "a", e os
 * opostos ficam frente a frente. Cada raio vale a intensidade daquele polo (0 a 100).
 */

/** Um eixo no gráfico: o nome da dimensão, o dos polos e a nota (negativa é o polo "a"). */
export type ChartAxis = { key: Axis; label: string; poleA: string; poleB: string; score: number };

/** Um raio do gráfico: o nome do polo, o lado e a intensidade de 0 a 100. */
export type ChartSpoke = { label: string; side: "a" | "b"; intensity: number };

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
    ...axes.map((axis): ChartSpoke => ({ label: axis.poleA, side: "a", intensity: Math.max(0, -axis.score) })),
    ...axes.map((axis): ChartSpoke => ({ label: axis.poleB, side: "b", intensity: Math.max(0, axis.score) })),
  ];
}

/** Ponto do raio `index` (de `count`) à distância `radius` do centro; o raio 0 aponta para cima. */
export function spokePoint(index: number, count: number, radius: number, center: { x: number; y: number }): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}
