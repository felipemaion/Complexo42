// Gera as imagens dos escudos das casas e do logo do app para public/casas (WebP + PNG fallback,
// quadradas, 512 e 128 px), a partir dos PNG originais (grandes, com muita margem transparente).
// Uso: node scripts/otimizar-escudos.mjs <pasta com Esparta.png Atenas.png Alexandria.png Siracusa.png Incubadora.png>
// Os originais não vão para o repositório. Precisa do `sharp` (vem com o Next).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source) {
  console.error("informe a pasta dos PNG originais");
  process.exit(1);
}
const out = "public/casas";
mkdirSync(out, { recursive: true });

const names = { Esparta: "esparta", Atenas: "atenas", Alexandria: "alexandria", Siracusa: "siracusa", Incubadora: "app-logo" };
for (const [file, id] of Object.entries(names)) {
  // Recorta a margem transparente e deixa o escudo centrado num quadrado, para o tamanho ser fixo na tela.
  const trimmed = await sharp(join(source, `${file}.png`)).trim({ threshold: 10 }).toBuffer();
  for (const size of [512, 128]) {
    const base = sharp(trimmed).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
    await base.clone().webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(join(out, `${id}-${size}.webp`));
    await base.clone().png({ compressionLevel: 9, palette: true, quality: 85, effort: 10 }).toFile(join(out, `${id}-${size}.png`));
  }
  console.log("ok", id);
}
