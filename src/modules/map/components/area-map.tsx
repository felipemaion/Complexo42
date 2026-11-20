import shapes from "../data/rmsp-paths.json";
import { intensity, type AreaCount } from "../server/areas";

// Mapa coroplético da Região Metropolitana de São Paulo (#24): malha do IBGE (qualidade mínima)
// desenhada em SVG, sem servidor de mapas nem tiles de terceiros. A cor é a do tema (primary) com
// força proporcional à contagem; "< 5" fica fraca e sem número. Cada área tem título acessível.
type AreaMapProps = {
  readonly cities: ReadonlyMap<number, AreaCount>;
  readonly label: string;
  readonly fewLabel: string;
};

export function AreaMap({ cities, label, fewLabel }: AreaMapProps) {
  const max = Math.max(1, ...[...cities.values()].map((city) => city.people ?? 0));
  return (
    <svg viewBox={`0 0 ${shapes.width} ${shapes.height}`} role="img" aria-label={label} className="h-auto w-full rounded-2xl border border-line bg-canvas">
      {shapes.areas.map((area) => {
        const count = cities.get(area.code);
        const strength = intensity(count === undefined ? undefined : count.people, max);
        const people = count === undefined ? 0 : (count.people ?? fewLabel);
        return (
          <path key={area.code} d={area.d} className="fill-primary stroke-line" fillOpacity={strength === 0 ? 0.04 : strength} strokeWidth={1.5}>
            <title>{`${area.name}: ${people}`}</title>
          </path>
        );
      })}
    </svg>
  );
}
