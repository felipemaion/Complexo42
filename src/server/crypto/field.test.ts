// Critérios da #45 (ADR 0003 §3). Chaves geradas no próprio teste: nenhum segredo real.
import { describe, expect, it } from "vitest";
import { FieldCryptoError, type FieldCryptoErrorCode } from "./errors";
import {
  blindIndexWith,
  decryptWith,
  emailBlindIndexWith,
  encryptWith,
  keyVersionOf,
  normalizeEmail,
  reencryptWith,
  whatsappBlindIndexWith,
  type FieldContext,
} from "./field";
import { importKeyring, type Keyring } from "./keys";

const randomKey = () => crypto.getRandomValues(new Uint8Array(32));

function keyring(fieldKeys: Record<number, Uint8Array>, currentVersion: number, blindIndexKey = randomKey()): Promise<Keyring> {
  return importKeyring({ currentVersion, fieldKeys: new Map(Object.entries(fieldKeys).map(([v, k]) => [Number(v), k])), blindIndexKey });
}

const ctx: FieldContext = { table: "profiles", column: "whatsapp_enc", rowId: "6f1c2a52-6a3e-4c1f-9d0b-2f0f5f4c8a11" };
const SECRET = "+5511999998888";

async function failsWith(promise: Promise<unknown>, code: FieldCryptoErrorCode): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FieldCryptoError);
  expect((error as FieldCryptoError).code).toBe(code);
  // R11: a mensagem nunca leva texto claro.
  expect((error as FieldCryptoError).message).not.toContain(SECRET);
}

describe("cifrar e decifrar", () => {
  it("ida e volta devolve o texto original, inclusive acentos e vazio", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    for (const text of [SECRET, "José da Conceição 🌱", ""]) {
      expect(await decryptWith(k, await encryptWith(k, text, ctx), ctx)).toBe(text);
    }
  });

  it("segue o formato v1.<iv 12 bytes>.<ct+tag> em base64url", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    const value = await encryptWith(k, SECRET, ctx);
    const [version, iv, ct] = value.split(".");
    expect(version).toBe("v1");
    expect(Buffer.from(iv as string, "base64url")).toHaveLength(12);
    // GCM não expande o texto: ciphertext = tamanho do texto + 16 bytes de tag.
    expect(Buffer.from(ct as string, "base64url")).toHaveLength(Buffer.byteLength(SECRET) + 16);
    expect(value).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(value).not.toContain(SECRET);
  });

  it("IV aleatório: o mesmo texto cifrado duas vezes dá valores diferentes", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    const a = await encryptWith(k, SECRET, ctx);
    const b = await encryptWith(k, SECRET, ctx);
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("AAD diferente (outra linha, coluna ou tabela) FALHA", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    const value = await encryptWith(k, SECRET, ctx);
    await failsWith(decryptWith(k, value, { ...ctx, rowId: "outra-linha" }), "decrypt_failed");
    await failsWith(decryptWith(k, value, { ...ctx, column: "display_name_enc" }), "decrypt_failed");
    await failsWith(decryptWith(k, value, { ...ctx, table: "members" }), "decrypt_failed");
  });

  it("chave errada FALHA", async () => {
    const value = await encryptWith(await keyring({ 1: randomKey() }, 1), SECRET, ctx);
    await failsWith(decryptWith(await keyring({ 1: randomKey() }, 1), value, ctx), "decrypt_failed");
  });

  it("valor adulterado FALHA (ciphertext, tag ou IV)", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    const [version, iv, ct] = (await encryptWith(k, SECRET, ctx)).split(".") as [string, string, string];
    const flip = (b64: string, index: number) => {
      const bytes = Buffer.from(b64, "base64url");
      bytes[index] = (bytes[index] as number) ^ 0x01;
      return bytes.toString("base64url");
    };
    await failsWith(decryptWith(k, `${version}.${iv}.${flip(ct, 0)}`, ctx), "decrypt_failed");
    await failsWith(decryptWith(k, `${version}.${iv}.${flip(ct, Buffer.from(ct, "base64url").length - 1)}`, ctx), "decrypt_failed");
    await failsWith(decryptWith(k, `${version}.${flip(iv, 0)}.${ct}`, ctx), "decrypt_failed");
  });

  it("versão desconhecida FALHA", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    const value = await encryptWith(k, SECRET, ctx);
    await failsWith(decryptWith(k, value.replace(/^v1\./, "v2."), ctx), "unknown_version");
  });

  it.each([
    ["vazio", ""],
    ["sem versão", "abc.def"],
    ["versão zero", "v0.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA"],
    ["IV curto", "v1.AAAA.AAAAAAAAAAAAAAAAAAAAAA"],
    ["sem tag", "v1.AAAAAAAAAAAAAAAA.AAAA"],
    ["base64 padrão em vez de url", "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAA+/"],
    ["base64url não canônico", "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAB"],
    ["parte a mais", "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.x"],
    ["espaço", " v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA"],
  ])("valor malformado (%s) FALHA", async (_, value) => {
    const k = await keyring({ 1: randomKey() }, 1);
    await failsWith(decryptWith(k, value, ctx), "malformed");
  });

  it("recusa contexto inválido ao cifrar e ao decifrar", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    const value = await encryptWith(k, SECRET, ctx);
    for (const bad of [
      { ...ctx, rowId: "" },
      { ...ctx, rowId: "a.b" }, // ponto deixaria o AAD ambíguo
      { ...ctx, table: "Profiles" },
      { ...ctx, column: "a.b" },
    ]) {
      await failsWith(encryptWith(k, SECRET, bad), "invalid_context");
      await failsWith(decryptWith(k, value, bad), "invalid_context");
    }
  });

  it("recusa texto que não é string ou passa de 64 KiB", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    await failsWith(encryptWith(k, 42 as unknown as string, ctx), "invalid_input");
    await failsWith(encryptWith(k, "x".repeat(64 * 1024 + 1), ctx), "invalid_input");
  });
});

describe("rotação de chave", () => {
  it("chave nova cifra como v2 e ainda decifra valores v1 com a chave antiga", async () => {
    const old = randomKey();
    const blind = randomKey();
    const before = await keyring({ 1: old }, 1, blind);
    const legacy = await encryptWith(before, SECRET, ctx);

    const after = await keyring({ 1: old, 2: randomKey() }, 2, blind);
    const fresh = await encryptWith(after, SECRET, ctx);
    expect(keyVersionOf(legacy)).toBe(1);
    expect(keyVersionOf(fresh)).toBe(2);
    expect(await decryptWith(after, legacy, ctx)).toBe(SECRET);
    expect(await decryptWith(after, fresh, ctx)).toBe(SECRET);
    // Sem a chave nova, o valor v2 é versão desconhecida.
    await failsWith(decryptWith(before, fresh, ctx), "unknown_version");
  });

  it("recifrar leva v1 para v2 e mantém o que já está na versão atual", async () => {
    const old = randomKey();
    const k = await keyring({ 1: old, 2: randomKey() }, 2);
    const legacy = await encryptWith(await keyring({ 1: old }, 1), SECRET, ctx);
    const rotated = await reencryptWith(k, legacy, ctx);
    expect(keyVersionOf(rotated)).toBe(2);
    expect(await decryptWith(k, rotated, ctx)).toBe(SECRET);
    expect(await reencryptWith(k, rotated, ctx)).toBe(rotated);
    // Valor atual que não decifra não passa como "já rotacionado".
    await failsWith(reencryptWith(k, rotated, { ...ctx, rowId: "outra" }), "decrypt_failed");
  });

  it("recusa chaves malformadas ou repetidas", async () => {
    const same = randomKey();
    await expect(keyring({ 1: randomKey() }, 2)).rejects.toMatchObject({ code: "invalid_key" });
    await expect(keyring({ 1: new Uint8Array(16) }, 1)).rejects.toMatchObject({ code: "invalid_key" });
    await expect(keyring({ 1: randomKey() }, 1, new Uint8Array(31))).rejects.toMatchObject({ code: "invalid_key" });
    await expect(keyring({ 1: same }, 1, same)).rejects.toMatchObject({ code: "invalid_key" });
    await expect(keyring({ 0: randomKey() }, 0)).rejects.toMatchObject({ code: "invalid_key" });
  });
});

describe("índice cego (HMAC-SHA256)", () => {
  it("é determinístico, em hex de 64 caracteres, e igual ao HMAC-SHA256 de referência", async () => {
    const blind = randomKey();
    const k = await keyring({ 1: randomKey() }, 1, blind);
    const a = await whatsappBlindIndexWith(k, SECRET);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await whatsappBlindIndexWith(k, SECRET)).toBe(a);
    const { createHmac } = await import("node:crypto");
    expect(a).toBe(createHmac("sha256", blind).update(`wa:${SECRET}`).digest("hex"));
    const email = await emailBlindIndexWith(k, "Pessoa@Exemplo.org ");
    expect(email).toBe(createHmac("sha256", blind).update("em:pessoa@exemplo.org").digest("hex"));
  });

  it("separa domínios: o mesmo texto bruto dá índices diferentes em \"wa\" e \"em\"", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    for (const raw of [SECRET, "pessoa@exemplo.org"]) {
      expect(await blindIndexWith(k, "wa", raw)).not.toBe(await blindIndexWith(k, "em", raw));
    }
    expect(await whatsappBlindIndexWith(k, SECRET)).toBe(await blindIndexWith(k, "wa", SECRET));
    expect(await emailBlindIndexWith(k, "pessoa@exemplo.org")).toBe(await blindIndexWith(k, "em", "pessoa@exemplo.org"));
  });

  it("normaliza o e-mail (minúsculas e sem espaços nas pontas)", async () => {
    const k = await keyring({ 1: randomKey() }, 1);
    const expected = await emailBlindIndexWith(k, "pessoa@exemplo.org");
    expect(await emailBlindIndexWith(k, "  Pessoa@Exemplo.ORG \n")).toBe(expected);
    expect(normalizeEmail("  Pessoa@Exemplo.ORG ")).toBe("pessoa@exemplo.org");
    expect(await emailBlindIndexWith(k, "outra@exemplo.org")).not.toBe(expected);
  });

  it("chaves diferentes dão HMAC diferente", async () => {
    const a = await keyring({ 1: randomKey() }, 1);
    const b = await keyring({ 1: randomKey() }, 1);
    expect(await whatsappBlindIndexWith(a, SECRET)).not.toBe(await whatsappBlindIndexWith(b, SECRET));
    expect(await emailBlindIndexWith(a, "pessoa@exemplo.org")).not.toBe(await emailBlindIndexWith(b, "pessoa@exemplo.org"));
  });

  it("não depende da chave de cifra: trocar FIELD_ENCRYPTION_KEY não muda o índice", async () => {
    const blind = randomKey();
    const a = await keyring({ 1: randomKey() }, 1, blind);
    const b = await keyring({ 2: randomKey() }, 2, blind);
    expect(await whatsappBlindIndexWith(a, SECRET)).toBe(await whatsappBlindIndexWith(b, SECRET));
  });

  it.each(["", "11999998888", "+55 11 99999-8888", "+0123456789", "+1234567", "+1234567890123456"])(
    "recusa WhatsApp fora de E.164: %j",
    async (value) => {
      const k = await keyring({ 1: randomKey() }, 1);
      await failsWith(whatsappBlindIndexWith(k, value), "invalid_input");
    },
  );

  it.each(["", "   ", "sem-arroba", "a@b@c", "a b@c.org", `${"a".repeat(250)}@c.org`])("recusa e-mail inválido: %j", async (value) => {
    const k = await keyring({ 1: randomKey() }, 1);
    await failsWith(emailBlindIndexWith(k, value), "invalid_input");
  });
});
