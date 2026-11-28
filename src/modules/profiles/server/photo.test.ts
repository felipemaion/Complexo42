// Serviço da foto (#308): converte, cifra com o AAD da linha e grava por `save_own_photo`; lê e
// decifra com o JWT de quem pede (a RLS decide); remove a própria. O banco é testado em
// supabase/tests/profile_photo.test.sql.
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { decryptWith, encryptWith, type FieldContext } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";
import { createLogger } from "@/server/log";
import { loadPhoto, readBodyCapped, removeOwnPhoto, savePhoto, type PhotoDeps } from "./photo";
import type { ProfileDbClient } from "../types";

const key = () => crypto.getRandomValues(new Uint8Array(32));
const keyring = importKeyring({ fieldKeys: new Map([[1, key()]]), currentVersion: 1, blindIndexKey: key() });
const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
const OTHER = "1c7a3e5f-4d2b-4a9f-8e3c-8b6d7f2a1b04";

function deps(): { deps: PhotoDeps; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    deps: {
      encrypt: async (plain: string, ctx: FieldContext) => encryptWith(await keyring, plain, ctx),
      decrypt: async (value: string, ctx: FieldContext) => decryptWith(await keyring, value, ctx),
      log: createLogger(undefined, (line) => lines.push(line)),
    },
  };
}

const jpeg = () => sharp({ create: { width: 640, height: 480, channels: 3, background: "#aa7755" } }).jpeg().toBuffer();

type Opts = { rpcData?: unknown; rpcError?: unknown; row?: unknown; readError?: unknown; deleteError?: unknown };
function fakeClient(opts: Opts = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const reads: { table: string; columns: string; eq: [string, string] }[] = [];
  const deletes: { table: string; eq: [string, string] }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return opts.rpcError ? { data: null, error: opts.rpcError } : { data: null, error: null };
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          reads.push({ table, columns, eq: [column, value] });
          return { maybeSingle: async () => ({ data: opts.row ?? null, error: opts.readError ?? null }) };
        },
      }),
      delete: () => ({
        eq: async (column: string, value: string) => {
          deletes.push({ table, eq: [column, value] });
          return { error: opts.deleteError ?? null };
        },
      }),
    }),
  };
  return { client: client as unknown as ProfileDbClient, calls, reads, deletes };
}

describe("savePhoto", () => {
  it("converte, cifra a miniatura em base64 com o AAD da linha e chama save_own_photo", async () => {
    const { client, calls } = fakeClient();
    const { deps: d, lines } = deps();
    expect(await savePhoto(client, USER, await jpeg(), d)).toEqual({ status: "saved" });
    // Primeiro reserva a cota (antes do sharp), depois grava.
    expect(calls.map((call) => call.fn)).toEqual(["reserve_photo_upload", "save_own_photo"]);
    const enc = calls[1]!.args.p_photo_enc as string;
    const plain = await d.decrypt(enc, { table: "profile_photos", column: "photo_enc", rowId: USER });
    const webp = Buffer.from(plain, "base64");
    expect((await sharp(webp).metadata()).format).toBe("webp");
    await expect(d.decrypt(enc, { table: "profile_photos", column: "photo_enc", rowId: OTHER })).rejects.toThrow();
    // Nada em texto puro sai para o banco nem para o log (R11, R13).
    expect(enc).not.toContain(plain.slice(0, 40));
    expect(lines).toEqual([]);
  });

  it("não é imagem aceita: invalid_type, sem cifrar nem chamar o banco", async () => {
    const { client, calls } = fakeClient();
    const { deps: d } = deps();
    expect(await savePhoto(client, USER, Buffer.from("<script>alert(1)</script>"), d)).toEqual({ status: "invalid_type" });
    expect(await savePhoto(client, USER, Buffer.alloc(photoBytes() + 1), d)).toEqual({ status: "too_large" });
    expect(calls).toEqual([]);
  });

  it("imagem quebrada: unreadable, mas JÁ consumiu a cota (não grava nada)", async () => {
    const { client, calls } = fakeClient();
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("lixo")]);
    expect(await savePhoto(client, USER, broken, deps().deps)).toEqual({ status: "unreadable" });
    expect(calls.map((call) => call.fn)).toEqual(["reserve_photo_upload"]);
  });

  it("cota esgotada: recusa ANTES de converter (o sharp nem é chamado)", async () => {
    const { client, calls } = fakeClient({ rpcError: { code: "PT429", message: "too_many_attempts" } });
    const thumbnail = vi.spyOn(await import("./photo-image"), "makePhotoThumbnail");
    expect(await savePhoto(client, USER, await jpeg(), deps().deps)).toEqual({ status: "too_many_attempts" });
    expect(thumbnail).not.toHaveBeenCalled();
    expect(calls.map((call) => call.fn)).toEqual(["reserve_photo_upload"]);
    thumbnail.mockRestore();
  });

  it.each([
    [{ code: "PT429", message: "too_many_attempts" }, "too_many_attempts"],
    [{ code: "42501", message: "x" }, "forbidden"],
    [{ code: "XX000", message: "Pessoa Secreta" }, "failed"],
  ] as const)("erro %j do banco vira %s, logando só o código (R11)", async (rpcError, status) => {
    const { client } = fakeClient({ rpcError });
    const { deps: d, lines } = deps();
    expect(await savePhoto(client, USER, await jpeg(), d)).toEqual({ status });
    expect(lines.join("\n")).not.toContain("Pessoa Secreta");
  });
});

/** O teto de envio, sem importar a constante em dois lugares nos testes. */
function photoBytes(): number {
  return 2 * 1024 * 1024;
}

describe("loadPhoto", () => {
  it("decifra com o AAD do dono da foto (não de quem pede) e devolve os bytes do WebP", async () => {
    const { deps: d } = deps();
    const webp = await sharp({ create: { width: 192, height: 256, channels: 3, background: "#123456" } }).webp().toBuffer();
    const enc = await d.encrypt(webp.toString("base64"), { table: "profile_photos", column: "photo_enc", rowId: OTHER });
    const { client, reads } = fakeClient({ row: { photo_enc: enc } });
    const out = await loadPhoto(client, OTHER, d);
    expect(out?.equals(webp)).toBe(true);
    expect(reads[0]).toMatchObject({ table: "profile_photos", eq: ["profile_id", OTHER] });
  });

  it("sem linha (ou a RLS escondeu): null, igual para os dois casos", async () => {
    expect(await loadPhoto(fakeClient().client, OTHER, deps().deps)).toBeNull();
  });

  it("valor que não decifra, ou que não é WebP: null, logando só o nome da coluna", async () => {
    const { deps: d, lines } = deps();
    const copied = await d.encrypt("AAAA", { table: "profile_photos", column: "photo_enc", rowId: USER });
    expect(await loadPhoto(fakeClient({ row: { photo_enc: copied } }).client, OTHER, d)).toBeNull();
    const notWebp = await d.encrypt(Buffer.from("texto").toString("base64"), { table: "profile_photos", column: "photo_enc", rowId: OTHER });
    expect(await loadPhoto(fakeClient({ row: { photo_enc: notWebp } }).client, OTHER, d)).toBeNull();
    expect(lines.join("\n")).toContain("photo_enc");
    expect(lines.join("\n")).not.toContain(copied);
  });

  it("id que não é uuid: null, sem consultar o banco", async () => {
    const { client, reads } = fakeClient();
    expect(await loadPhoto(client, "../../etc/passwd", deps().deps)).toBeNull();
    expect(reads).toEqual([]);
  });

  it("erro de leitura: sobe (falha fechada), em vez de fingir que não há foto", async () => {
    await expect(loadPhoto(fakeClient({ readError: { code: "XX000" } }).client, OTHER, deps().deps)).rejects.toThrow("photo_read_failed");
  });
});

describe("removeOwnPhoto", () => {
  it("apaga a linha da própria pessoa", async () => {
    const { client, deletes } = fakeClient();
    expect(await removeOwnPhoto(client, USER, deps().deps)).toBe(true);
    expect(deletes).toEqual([{ table: "profile_photos", eq: ["profile_id", USER] }]);
  });

  it("erro do banco: false, logando só o código", async () => {
    const { deps: d, lines } = deps();
    expect(await removeOwnPhoto(fakeClient({ deleteError: { code: "42501" } }).client, USER, d)).toBe(false);
    expect(lines.join("\n")).toContain("42501");
  });
});

describe("readBodyCapped (limite do corpo ANTES de ler tudo)", () => {
  const streamOf = (chunks: Uint8Array[], onPull?: () => void) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        onPull?.();
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });

  it("lê o corpo que cabe no limite", async () => {
    const out = await readBodyCapped(streamOf([Uint8Array.of(1, 2), Uint8Array.of(3)]), 10);
    expect(out && [...out]).toEqual([1, 2, 3]);
  });

  it("passou do limite: devolve null e PARA de puxar o fluxo (não lê o resto)", async () => {
    let pulls = 0;
    const chunks = Array.from({ length: 1000 }, () => new Uint8Array(1024));
    expect(await readBodyCapped(streamOf(chunks, () => pulls++), 4096)).toBeNull();
    expect(pulls).toBeLessThan(20);
  });

  it("sem corpo: bytes vazios", async () => {
    expect((await readBodyCapped(null, 10))?.length).toBe(0);
  });
});
