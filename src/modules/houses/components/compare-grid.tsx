// "Compare as casas": grade 2x2 de cartões compactos (também no celular). Escudo centralizado em cima, nome em MAIÚSCULAS
// (só CSS) e descrição curta (3 linhas) abaixo. O cartão selecionado leva borda grossa na cor da casa, fundo tingido e marca de
// seleção; os outros ficam neutros. "Atual" e "Sugerida" são chips pequenos na mesma linha. Só apresentação.
import type { InstanceConfig } from "@/modules/instance";
import { ShieldPicture } from "./house-shield";
import { shieldAssets } from "@/modules/instance/domain/house-shield";
import type { HouseView } from "./house-presentation";

type Props = {
  houses: readonly HouseView[];
  suggestedId?: string | undefined;
  currentId?: string | undefined;
  selectedId?: string | undefined;
  text: InstanceConfig["houseSelection"]["compare"];
  disabled: boolean;
  onSelect(houseId: string): void;
};

const colorOf = (color: HouseView["color"]) => `light-dark(${color.light}, ${color.dark})`;
const neutralBorder = "light-dark(#767676, #8a8a8a)";
const chip = "rounded-full border border-current px-2 py-0.5 text-sm font-semibold";

export function CompareHouseGrid({ houses, suggestedId, currentId, selectedId, text, disabled, onSelect }: Readonly<Props>) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {houses.map((house) => {
        const isSelected = house.id === selectedId;
        const color = colorOf(house.color);
        return (
          <li key={house.id} className="flex">
            <button
              type="button"
              className="relative flex w-full flex-col items-center gap-2 rounded-xl border-solid px-3 py-4 text-center focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-60"
              style={{
                borderWidth: isSelected ? 4 : 2,
                borderColor: isSelected ? color : neutralBorder,
                ...(isSelected && { backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }),
              }}
              aria-pressed={isSelected}
              {...(house.id === currentId && { "aria-current": "true" as const })}
              data-testid={`compare-house-${house.id}`}
              data-suggested={house.id === suggestedId ? "true" : undefined}
              onClick={() => onSelect(house.id)}
              disabled={disabled}
            >
              {isSelected && (
                <span
                  aria-hidden="true"
                  data-testid="compare-check"
                  className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full text-sm font-bold"
                  style={{ backgroundColor: color, color: "light-dark(#fff, #000)" }}
                >
                  ✓
                </span>
              )}
              <ShieldPicture
                assets={shieldAssets(house.id)}
                alt={house.name}
                size={96}
                testId="house-shield"
                fluid={{ className: "size-[72px] sm:size-[96px]", sizes: "(min-width: 640px) 96px, 72px" }}
              />
              <span className="text-lg font-bold uppercase tracking-wide">{house.name}</span>
              {(house.id === currentId || house.id === suggestedId || isSelected) && (
                <span className="flex flex-wrap items-center justify-center gap-1">
                  {house.id === currentId && <span className={chip} data-testid="current-badge">{text.currentBadge}</span>}
                  {house.id === suggestedId && <span className={chip} data-testid="suggested-badge">{text.suggestedBadge}</span>}
                  {isSelected && <span className="text-sm font-semibold">{text.selectedBadge}</span>}
                </span>
              )}
              <span className="line-clamp-3 text-base font-normal">{house.description}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
