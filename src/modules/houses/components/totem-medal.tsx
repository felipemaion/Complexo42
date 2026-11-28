// Medalha do totem e o destaque casa escolhida + medalha. SÓ para o detalhe do resultado de uma pessoa na
// coordenação (que registra o acesso; a lista de resultados não mostra totem): o totem nunca aparece para a pessoa, e tests/totem-medal-privacy.test.ts barra qualquer tela dela
// que importe este arquivo. Mesmo tamanho do escudo da casa; alt = nome do totem.
import { totemMedalAssets } from "@/modules/instance/domain/totem-medal";
import { HouseShield, ShieldPicture } from "./house-shield";

/** A medalha do totem; nada se o código não tem medalha. */
export function TotemMedal({ code, name, size = 32 }: Readonly<{ code: string | null; name: string; size?: number }>) {
  const assets = totemMedalAssets(code);
  if (!assets) return null;
  return <ShieldPicture assets={assets} alt={name} size={size} testId="totem-medal" />;
}

/**
 * Destaque do resultado de uma pessoa: o brasão da casa ESCOLHIDA e, ao lado, a medalha do totem, do mesmo
 * tamanho (grande), cada um com o nome embaixo. Sem casa escolhida, só a medalha; sem medalha, só o brasão.
 */
export function ChosenHouseAndTotem({ houseId, houseName, totemCode, totemName, size = 96 }: Readonly<{ houseId: string | null; houseName: string; totemCode: string | null; totemName: string; size?: number }>) {
  const medal = totemMedalAssets(totemCode);
  if (houseId === null && !medal) return null;
  return (
    <div className="flex items-start justify-center gap-6" data-testid="result-hero">
      {houseId !== null && (
        <figure className="flex flex-col items-center gap-2 text-center">
          <HouseShield houseId={houseId} name={houseName} size={size} />
          <figcaption className="text-lg font-semibold">{houseName}</figcaption>
        </figure>
      )}
      {medal && (
        <figure className="flex flex-col items-center gap-2 text-center">
          <TotemMedal code={totemCode} name={totemName} size={size} />
          <figcaption className="text-lg font-semibold">{totemName}</figcaption>
        </figure>
      )}
    </div>
  );
}
