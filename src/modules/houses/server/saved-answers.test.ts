// Tamanho real das últimas respostas cifradas (#256): 26 respostas cifradas de verdade (AES-GCM) cabem com folga no teto de
// 4096 caracteres da coluna `questionnaire_results.answers_enc`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKeyringCache } from "@/server/crypto/keys";

vi.mock("server-only", () => ({}));

const b64 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const format = /^v[1-9][0-9]{0,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;
const answersOf = (count: number, width = 2) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`q${String(index + 1).padStart(width, "0")}`, [-5, -3, -1, 1, 3, 5][index % 6]!]));
const ctx = { table: "questionnaire_results", column: "answers_enc", rowId: "00000000-0000-4000-8000-000000000001" };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FIELD_ENCRYPTION_KEY", b64());
  vi.stubEnv("BLIND_INDEX_KEY", b64());
  resetKeyringCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetKeyringCache();
});

describe("respostas guardadas: tamanho real cifrado", () => {
  it("as 26 respostas da chave atual cifradas ficam no formato do banco e usam menos de um quarto do teto", async () => {
    const { encryptField } = await import("@/server/crypto");
    const sealed = await encryptField(JSON.stringify(answersOf(26)), ctx);
    expect(sealed).toMatch(format);
    // Teto da coluna: 4096. Margem de pelo menos 4x sobre o caso real.
    expect(sealed.length).toBeLessThan(4096 / 4);
  });

  it("uma chave bem maior (150 itens, ids longos) ainda cabe no teto", async () => {
    const { encryptField } = await import("@/server/crypto");
    const sealed = await encryptField(JSON.stringify(answersOf(150, 4)), ctx);
    expect(sealed).toMatch(format);
    expect(sealed.length).toBeLessThanOrEqual(4096);
  });

  it("decifra de volta com o mesmo contexto (AAD da linha da pessoa) e não com o de outra pessoa", async () => {
    const { decryptField, encryptField } = await import("@/server/crypto");
    const answers = answersOf(26);
    const sealed = await encryptField(JSON.stringify(answers), ctx);
    expect(JSON.parse(await decryptField(sealed, ctx))).toEqual(answers);
    await expect(decryptField(sealed, { ...ctx, rowId: "00000000-0000-4000-8000-000000000002" })).rejects.toThrow();
  });
});
