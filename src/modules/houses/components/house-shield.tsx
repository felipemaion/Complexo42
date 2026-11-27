// Escudo de uma casa e logo do app. Só apresentação: tamanho fixo (sem salto de layout), carregamento
// preguiçoso e decodificação fora da renderização; WebP com PNG de reserva; alt com o nome.
import { appLogo, shieldAssets, type ShieldAssets } from "@/modules/instance/domain/house-shield";

/** `fluid`: o tamanho vem do CSS (className), com `size` como tamanho intrínseco (sem layout shift) e `sizes` para o srcset. */
type PictureProps = { assets: ShieldAssets; alt: string; size: number; eager?: boolean; testId?: string; fluid?: { className: string; sizes: string } };

function ShieldPicture({ assets, alt, size, eager = false, testId, fluid }: Readonly<PictureProps>) {
  const sizes = fluid?.sizes ?? `${size}px`;
  return (
    <picture>
      <source type="image/webp" srcSet={`${assets.webp128} 128w, ${assets.webp512} 512w`} sizes={sizes} />
      <img
        src={assets.png128}
        srcSet={`${assets.png128} 128w, ${assets.png512} 512w`}
        sizes={sizes}
        alt={alt}
        width={size}
        height={size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        data-testid={testId}
        className={fluid ? `shrink-0 ${fluid.className}` : "shrink-0"}
        style={fluid ? undefined : { width: size, height: size }}
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

/** O logo em destaque (página de entrada): 120 px no celular, 180 px a partir de `sm`; largura e altura no HTML. */
export function AppLogoHero({ name }: Readonly<{ name: string }>) {
  return (
    <ShieldPicture
      assets={appLogo()}
      alt={name}
      size={180}
      eager
      testId="app-logo"
      fluid={{ className: "size-[120px] sm:size-[180px]", sizes: "(min-width: 640px) 180px, 120px" }}
    />
  );
}

/** A casa com o escudo ao lado do nome (listas e resultado da coordenação: casa sugerida e casa escolhida). */
export function HouseWithShield({ houseId, name, size = 32 }: Readonly<{ houseId: string; name: string; size?: number }>) {
  return (
    <span className="inline-flex items-center gap-2">
      <HouseShield houseId={houseId} name={name} size={size} />
      {name}
    </span>
  );
}
