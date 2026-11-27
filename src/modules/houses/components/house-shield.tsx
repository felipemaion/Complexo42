// Escudo de uma casa e logo do app. Só apresentação: tamanho fixo (sem salto de layout), carregamento
// preguiçoso e decodificação fora da renderização; WebP com PNG de reserva; alt com o nome.
import { appLogo, shieldAssets, type ShieldAssets } from "@/modules/instance/domain/house-shield";

type PictureProps = { assets: ShieldAssets; alt: string; size: number; eager?: boolean; testId?: string };

function ShieldPicture({ assets, alt, size, eager = false, testId }: Readonly<PictureProps>) {
  return (
    <picture>
      <source type="image/webp" srcSet={`${assets.webp128} 128w, ${assets.webp512} 512w`} sizes={`${size}px`} />
      <img
        src={assets.png128}
        srcSet={`${assets.png128} 128w, ${assets.png512} 512w`}
        sizes={`${size}px`}
        alt={alt}
        width={size}
        height={size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        data-testid={testId}
        className="shrink-0"
        style={{ width: size, height: size }}
      />
    </picture>
  );
}

/** O escudo da casa, com o nome da casa como alt. */
export function HouseShield({ houseId, name, size = 64 }: Readonly<{ houseId: string; name: string; size?: number }>) {
  return <ShieldPicture assets={shieldAssets(houseId)} alt={name} size={size} testId="house-shield" />;
}

/** O logo do app (escudo do app): cabeçalho e página de entrada; alt = nome do app da config. */
export function AppLogo({ name, size = 40 }: Readonly<{ name: string; size?: number }>) {
  return <ShieldPicture assets={appLogo()} alt={name} size={size} eager testId="app-logo" />;
}
