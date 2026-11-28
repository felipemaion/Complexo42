import { describe, expect, it } from "vitest";
import { detectPhotoType, photoLimits } from "./photo";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

describe("detectPhotoType (pelos bytes, nunca pelo nome ou pelo tipo declarado)", () => {
  it("reconhece JPEG, PNG e WebP", () => {
    expect(detectPhotoType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("jpeg");
    expect(detectPhotoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("png");
    expect(detectPhotoType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 ")))).toBe("webp");
  });

  it("recusa o que não é uma dessas imagens (GIF, SVG, HTML, PDF, vazio, curto)", () => {
    expect(detectPhotoType(bytes(...ascii("GIF89a"), 0, 0, 0, 0, 0, 0))).toBeNull();
    expect(detectPhotoType(bytes(...ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")))).toBeNull();
    expect(detectPhotoType(bytes(...ascii("<script>alert(1)</script>")))).toBeNull();
    expect(detectPhotoType(bytes(...ascii("%PDF-1.7 trailer")))).toBeNull();
    expect(detectPhotoType(bytes())).toBeNull();
    expect(detectPhotoType(bytes(0xff, 0xd8))).toBeNull();
    // RIFF que não é WebP (WAVE).
    expect(detectPhotoType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE"), 0, 0))).toBeNull();
  });
});

describe("photoLimits", () => {
  it("o envio cabe em 2 MB e a miniatura é 3x4 de ~256 px", () => {
    expect(photoLimits.maxUploadBytes).toBe(2 * 1024 * 1024);
    expect(photoLimits.height).toBe(256);
    expect(photoLimits.width / photoLimits.height).toBeCloseTo(3 / 4);
    expect(photoLimits.uploadsPerHour).toBe(10);
  });

  it("o teto da miniatura, em base64, cabe no CHECK de 65 536 caracteres do banco (com folga para o envelope cifrado)", () => {
    expect(Math.ceil((photoLimits.maxOutputBytes * 4) / 3) + 100).toBeLessThan(65_536);
  });
});
