// Gera as medalhas dos totens para public/totens (WebP + PNG de reserva, quadradas, 512 e 128 px), a partir dos
// PNG originais (grandes, com margem). Uso: node scripts/otimizar-totens.mjs <pasta com PR.png PA.png AR.png AA.png>
// Os originais não vão para o repositório. Mesmo recorte e compressão de scripts/otimizar-escudos.mjs.
// O arquivo de cada medalha tem o código do totem em minúsculas (pr-512.webp); o nome do totem não vai no caminho.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source) {
  console.error("informe a pasta dos PNG originais");
  process.exit(1);
}
const out = "public/totens";
mkdirSync(out, { recursive: true });

for (const code of ["PR", "PA", "AR", "AA"]) {
  const trimmed = await sharp(join(source, `${code}.png`)).trim({ threshold: 10 }).toBuffer();
  for (const size of [512, 128]) {
    const base = sharp(trimmed).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
    await base.clone().webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(join(out, `${code.toLowerCase()}-${size}.webp`));
    await base.clone().png({ compressionLevel: 9, palette: true, quality: 85, effort: 10 }).toFile(join(out, `${code.toLowerCase()}-${size}.png`));
  }
  console.log("ok", code);
}
