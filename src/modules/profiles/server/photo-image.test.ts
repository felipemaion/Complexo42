// Conversão da foto (#308): o que entra é qualquer JPEG/PNG/WebP de até 2 MB; o que sai é uma
// miniatura WebP 192x256 SEM metadados (EXIF, GPS, XMP, ICC). Usa o sharp de verdade.
import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { photoLimits } from "../domain/photo";
import { makePhotoThumbnail } from "./photo-image";

/** Retrato sintético suave (degradê + um "rosto" circular): comprime como uma foto, não como ruído. */
async function portrait(width = 600, height = 800): Promise<Sharp> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8899aa"/><stop offset="1" stop-color="#223344"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width / 2}" cy="${height / 2.4}" r="${width / 4}" fill="#e0b090"/></svg>`;
  return sharp(Buffer.from(svg));
}

/** Os "fourcc" dos blocos do contêiner RIFF do WebP, na ordem. */
function riffChunks(webp: Buffer): string[] {
  const chunks: string[] = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    chunks.push(webp.toString("ascii", offset, offset + 4));
    offset += 8 + webp.readUInt32LE(offset + 4) + (webp.readUInt32LE(offset + 4) % 2);
  }
  return chunks;
}

describe("makePhotoThumbnail", () => {
  it("devolve WebP 192x256, leve, de um JPEG grande", async () => {
    const input = await (await portrait(1500, 2000)).jpeg().toBuffer();
    const result = await makePhotoThumbnail(input);
    if (!result.ok) throw new Error(`esperava sucesso, veio ${result.reason}`);
    const meta = await sharp(result.webp).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", photoLimits.width, photoLimits.height]);
    expect(result.webp.length).toBeLessThanOrEqual(photoLimits.maxOutputBytes);
  });

  it("aceita PNG e WebP, e uma imagem paisagem vira o recorte 3x4", async () => {
    const png = await (await portrait(800, 400)).png().toBuffer();
    const webp = await (await portrait(800, 400)).webp().toBuffer();
    for (const input of [png, webp]) {
      const result = await makePhotoThumbnail(input);
      if (!result.ok) throw new Error(result.reason);
      const meta = await sharp(result.webp).metadata();
      expect([meta.width, meta.height]).toEqual([photoLimits.width, photoLimits.height]);
    }
  });

  it("NÃO leva EXIF, GPS, XMP nem perfil ICC da foto original", async () => {
    const input = await (await portrait())
      .withExif({
        IFD0: { Copyright: "Fulano de Tal", Artist: "Beltrano", ImageDescription: "casa da rua tal" },
        IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "46/1 38/1 0/1" },
      })
      .withIccProfile("srgb")
      .jpeg()
      .toBuffer();
    // A entrada de fato carrega os metadados (senão o teste não provaria nada).
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(input.includes(Buffer.from("Fulano de Tal"))).toBe(true);

    const result = await makePhotoThumbnail(input);
    if (!result.ok) throw new Error(result.reason);
    const after = await sharp(result.webp).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(riffChunks(result.webp).filter((chunk) => ["EXIF", "XMP ", "ICCP"].includes(chunk))).toEqual([]);
    for (const secret of ["Fulano de Tal", "Beltrano", "casa da rua tal", "GPS", "Exif"]) {
      expect(result.webp.includes(Buffer.from(secret)), secret).toBe(false);
    }
  });

  it("aplica a orientação EXIF antes de recortar (a foto sai de pé) e depois a descarta", async () => {
    // 400x200: metade esquerda vermelha, direita azul; orientação 6 = girar 90° horário (esquerda vira o topo).
    const left = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const right = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#0000ff" } }).png().toBuffer();
    const input = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#000000" } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 200, top: 0 }])
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer();
    const result = await makePhotoThumbnail(input);
    if (!result.ok) throw new Error(result.reason);
    const { data, info } = await sharp(result.webp).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]!);
    const top = pixel(96, 20);
    const bottom = pixel(96, 235);
    expect(top[0]).toBeGreaterThan(top[2]!);
    expect(bottom[2]).toBeGreaterThan(bottom[0]!);
    expect((await sharp(result.webp).metadata()).orientation).toBeUndefined();
  });

  it("WebP animado: usa só o primeiro quadro, e a saída é estática (nada de pilha de quadros)", async () => {
    const frame = (background: string) => sharp({ create: { width: 300, height: 400, channels: 3, background } }).png().toBuffer();
    const animated = await sharp([await frame("#ff0000"), await frame("#0000ff"), await frame("#00ff00")], { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100, 100] })
      .toBuffer();
    // A entrada de fato é animada (senão o teste não provaria nada).
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(3);

    const result = await makePhotoThumbnail(animated);
    if (!result.ok) throw new Error(result.reason);
    const meta = await sharp(result.webp, { animated: true }).metadata();
    expect(meta.pages ?? 1).toBe(1);
    expect([meta.width, meta.height]).toEqual([photoLimits.width, photoLimits.height]);
    const { data, info } = await sharp(result.webp).raw().toBuffer({ resolveWithObject: true });
    const center = (info.height / 2 * info.width + info.width / 2) * info.channels;
    expect(data[center]).toBeGreaterThan(data[center + 2]!); // primeiro quadro: vermelho
  });

  it("GIF (animado ou não) não é aceito: o tipo é recusado pelos bytes", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    expect(await makePhotoThumbnail(gif)).toEqual({ ok: false, reason: "type" });
  });

  it("recusa o que não é JPEG, PNG ou WebP, mesmo com nome ou tipo enganoso", async () => {
    for (const input of [Buffer.from("<script>alert(1)</script>"), Buffer.from("GIF89a......"), Buffer.alloc(0), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")]) {
      expect(await makePhotoThumbnail(input)).toEqual({ ok: false, reason: "type" });
    }
  });

  it("assinatura de imagem com conteúdo quebrado: unreadable, sem derrubar o servidor", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("isto não é um JPEG de verdade")]);
    expect(await makePhotoThumbnail(broken)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("bomba de descompressão: poucos bytes com pixels demais são recusados antes de decodificar", async () => {
    const side = Math.ceil(Math.sqrt(photoLimits.maxInputPixels)) + 100;
    const bomb = await sharp({ create: { width: side, height: side, channels: 3, background: "#808080" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(photoLimits.maxUploadBytes);
    expect(await makePhotoThumbnail(bomb)).toEqual({ ok: false, reason: "unreadable" });
  }, 30_000);
});
