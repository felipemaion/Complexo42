// Medalha do totem e casa + medalha lado a lado. SÓ para telas da coordenação (resultado de uma pessoa e lista de
// resultados): o totem nunca aparece para a pessoa, e tests/totem-medal-privacy.test.ts barra qualquer tela dela
// que importe este arquivo. Mesmo tamanho do escudo da casa; alt = nome do totem.
import { totemMedalAssets } from "@/modules/instance/domain/totem-medal";
import { HouseShield, ShieldPicture } from "./house-shield";

/** A medalha do totem; nada se o código não tem medalha. */
export function TotemMedal({ code, name, size = 32 }: Readonly<{ code: string | null; name: string; size?: number }>) {
  const assets = totemMedalAssets(code);
  if (!assets) return null;
  return <ShieldPicture assets={assets} alt={name} size={size} testId="totem-medal" />;
}

/** O escudo da casa e, ao lado, a medalha do totem (mesmo tamanho), seguidos do nome da casa. */
export function HouseWithTotem({ houseId, houseName, totemCode, totemName, size = 32 }: Readonly<{ houseId: string; houseName: string; totemCode: string | null; totemName: string; size?: number }>) {
  return (
    <span className="inline-flex items-center gap-2">
      <HouseShield houseId={houseId} name={houseName} size={size} />
      <TotemMedal code={totemCode} name={totemName} size={size} />
      {houseName}
    </span>
  );
}
