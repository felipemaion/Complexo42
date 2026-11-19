// Serviço do formulário do perfil (#12): valida no servidor, cifra com AAD do id real da pessoa,
// calcula o HMAC aqui e chama `save_own_profile` com o JWT dela. O banco (permissão, formato,
// WhatsApp repetido) é testado em supabase/tests/profiles.test.sql.
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptWith, encryptWith, whatsappBlindIndexWith, type FieldContext } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";
import { createLogger } from "@/server/log";
import { hasOwnProfile, listMunicipalities, loadOwnProfile, saveOwnProfile, type ProfileDeps } from "./profile";
import type { ProfileDbClient } from "../types";

const key = () => crypto.getRandomValues(new Uint8Array(32));
const keyring = importKeyring({ fieldKeys: new Map([[1, key()]]), currentVersion: 1, blindIndexKey: key() });

const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
const SP = 3550308;
const NAME = "Maria Aparecida";
const PHONE_TYPED = "(11) 98765-4321";
const PHONE = "+5511987654321";
const form = { displayName: NAME, whatsapp: PHONE_TYPED, municipalityCode: String(SP), district: "Sé" };
const districtsFor = (code: number) => (code === SP ? ["Sé"] : undefined);

function deps(): { deps: ProfileDeps; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    deps: {
      encrypt: async (plain: string, ctx: FieldContext) => encryptWith(await keyring, plain, ctx),
      decrypt: async (value: string, ctx: FieldContext) => decryptWith(await keyring, value, ctx),
      blindIndex: async (e164: string) => whatsappBlindIndexWith(await keyring, e164),
      log: createLogger(undefined, (line) => lines.push(line)),
    },
  };
}

type Call = { fn: string; args: Record<string, unknown> };
/** Falso do cliente do Supabase: só o formato usado aqui (a tipagem real é do @supabase/ssr). */
function fakeClient(
  opts: { rpcData?: unknown; rpcError?: unknown; row?: unknown; rows?: unknown; readError?: unknown } = {},
) {
  const calls: Call[] = [];
  const reads: { table: string; columns: string; eq?: [string, string] }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      // Sem erro, a função devolve `saved` ou `duplicate_whatsapp` (#127).
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: "rpcData" in opts ? opts.rpcData : "saved", error: null };
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            reads.push({ table, columns, eq: [column, value] });
            return { data: opts.row ?? null, error: opts.readError ?? null };
          },
        }),
        order: async () => {
          reads.push({ table, columns });
          return { data: opts.rows ?? [], error: opts.readError ?? null };
        },
      }),
    }),
  };
  return { client: client as unknown as ProfileDbClient, calls, reads };
}

const leaks = (text: string) => [NAME, "98765", "4321", PHONE].filter((secret) => text.includes(secret));

afterEach(() => vi.restoreAllMocks());

describe("saveOwnProfile", () => {
  it("cifra com AAD do id da pessoa, calcula o HMAC no servidor e chama save_own_profile", async () => {
    const { client, calls } = fakeClient();
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, districtsFor, d)).toEqual({ status: "saved" });
    expect(calls).toHaveLength(1);
    const { fn, args } = calls[0]!;
    expect(fn).toBe("save_own_profile");
    expect(args).toMatchObject({
      p_municipality_code: SP,
      p_district: "Sé",
      p_social_links_enc: null,
      p_whatsapp_hmac: await whatsappBlindIndexWith(await keyring, PHONE),
    });
    // A versão do termo não sai do servidor: o banco grava `none` (revisão do PR #125).
    expect(args).not.toHaveProperty("p_consent_version");
    // Decifra só com o contexto certo (tabela.coluna.id da pessoa).
    const name = args.p_display_name_enc as string;
    const phone = args.p_whatsapp_enc as string;
    expect(await d.decrypt(name, { table: "profiles", column: "display_name_enc", rowId: USER })).toBe(NAME);
    expect(await d.decrypt(phone, { table: "profile_contacts", column: "whatsapp_enc", rowId: USER })).toBe(PHONE);
    await expect(d.decrypt(name, { table: "profiles", column: "display_name_enc", rowId: "outra-pessoa" })).rejects.toThrow();
    await expect(d.decrypt(phone, { table: "profiles", column: "display_name_enc", rowId: USER })).rejects.toThrow();
    // Nada em texto puro sai para o banco nem para o log.
    expect(leaks(JSON.stringify(calls))).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("entrada inválida: não cifra nem chama o banco, e devolve só os nomes dos campos", async () => {
    const { client, calls } = fakeClient();
    const { deps: d, lines } = deps();
    const encrypt = vi.spyOn(d, "encrypt");
    for (const [raw, fields] of [
      [{ ...form, displayName: "M" }, ["displayName"]],
      [{ ...form, whatsapp: "(11) 3456-7890" }, ["whatsapp"]],
      [{ ...form, municipalityCode: "abc" }, ["municipalityCode"]],
      [{ ...form, district: "Centro" }, ["district"]],
      [{}, ["displayName", "whatsapp", "municipalityCode"]],
    ] as const) {
      const result = await saveOwnProfile(client, USER, raw, districtsFor, d);
      expect(result).toEqual({ status: "invalid", fields });
    }
    expect(calls).toEqual([]);
    expect(encrypt).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("WhatsApp de outro cadastro (a função devolve duplicate_whatsapp): aviso, sem dizer de quem é", async () => {
    const { client } = fakeClient({ rpcData: "duplicate_whatsapp" });
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, districtsFor, d)).toEqual({ status: "duplicate_whatsapp" });
    expect(lines).toEqual([]);
  });

  it("limite de tentativas (PT429, #127): too_many_attempts, logado só o código", async () => {
    const { client } = fakeClient({ rpcError: { code: "PT429", message: "too_many_attempts", details: PHONE } });
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, districtsFor, d)).toEqual({ status: "too_many_attempts" });
    expect(lines).toHaveLength(1);
    // Exatamente estes campos: nem a mensagem nem o DETAIL do banco entram no log.
    const { ts, ...entry } = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(typeof ts).toBe("string");
    expect(entry).toEqual({ level: "warn", event: "profile_save_rate_limited", reason: "PT429" });
    expect(leaks(lines.join("\n"))).toEqual([]);
  });

  it("retorno inesperado da função (nem saved nem duplicate_whatsapp): failed, nunca saved", async () => {
    for (const rpcData of [null, "", "ok", { status: "saved" }]) {
      const { client } = fakeClient({ rpcData });
      const { deps: d, lines } = deps();
      expect(await saveOwnProfile(client, USER, form, districtsFor, d)).toEqual({ status: "failed" });
      expect(JSON.parse(lines[0]!)).toMatchObject({ event: "profile_save_failed", reason: "unexpected_result" });
    }
  });

  it("município que o banco não conhece (23503) volta como campo inválido", async () => {
    const { client } = fakeClient({ rpcError: { code: "23503", message: "município desconhecido" } });
    expect(await saveOwnProfile(client, USER, form, districtsFor, deps().deps)).toEqual({
      status: "invalid",
      fields: ["municipalityCode"],
    });
  });

  it("sem permissão (bloqueado ou suspenso, 42501): forbidden, logado só o código", async () => {
    const { client } = fakeClient({ rpcError: { code: "42501", message: `sem permissão ${NAME}` } });
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, districtsFor, d)).toEqual({ status: "forbidden" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "profile_save_denied", reason: "42501" });
    expect(leaks(lines.join("\n"))).toEqual([]);
  });

  it("outro erro do banco: failed, e o log nunca traz nome, WhatsApp nem a mensagem do banco (R11)", async () => {
    const { client } = fakeClient({ rpcError: { code: "XX000", message: `falha com ${NAME} e ${PHONE}`, details: PHONE } });
    const { deps: d, lines } = deps();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const consoleLog = vi.spyOn(console, "log");
    const consoleError = vi.spyOn(console, "error");
    expect(await saveOwnProfile(client, USER, form, districtsFor, d)).toEqual({ status: "failed" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "profile_save_failed", reason: "XX000" });
    expect(leaks(lines.join("\n"))).toEqual([]);
    expect(stdout).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falha ao cifrar: failed, sem chamar o banco e sem logar o texto", async () => {
    const { client, calls } = fakeClient();
    const { deps: d, lines } = deps();
    d.encrypt = async () => {
      throw Object.assign(new Error(`não cifrou ${NAME}`), { code: "invalid_key" });
    };
    expect(await saveOwnProfile(client, USER, form, districtsFor, d)).toEqual({ status: "failed" });
    expect(calls).toEqual([]);
    expect(leaks(lines.join("\n"))).toEqual([]);
  });

  it("id de usuário que não é uuid é recusado antes de tudo", async () => {
    const { client, calls } = fakeClient();
    await expect(saveOwnProfile(client, "x.y", form, districtsFor, deps().deps)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("loadOwnProfile", () => {
  it("decifra o próprio perfil com o id da pessoa", async () => {
    const { deps: d } = deps();
    const row = {
      display_name_enc: await d.encrypt(NAME, { table: "profiles", column: "display_name_enc", rowId: USER }),
      municipality_code: SP,
      district: "Sé",
      profile_contacts: { whatsapp_enc: await d.encrypt(PHONE, { table: "profile_contacts", column: "whatsapp_enc", rowId: USER }) },
    };
    const { client, reads } = fakeClient({ row });
    expect(await loadOwnProfile(client, USER, d)).toEqual({ displayName: NAME, whatsapp: PHONE, municipalityCode: SP, district: "Sé" });
    expect(reads[0]).toMatchObject({ table: "profiles", eq: ["id", USER] });
  });

  it("sem perfil devolve null; valor que não decifra vira campo vazio, sem logar o valor", async () => {
    const { deps: d, lines } = deps();
    expect(await loadOwnProfile(fakeClient().client, USER, d)).toBeNull();
    const copied = await d.encrypt(NAME, { table: "profiles", column: "display_name_enc", rowId: "outra" });
    const row = { display_name_enc: copied, municipality_code: SP, district: null, profile_contacts: null };
    expect(await loadOwnProfile(fakeClient({ row }).client, USER, d)).toEqual({
      displayName: "",
      whatsapp: "",
      municipalityCode: SP,
      district: null,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(copied);
  });

  it("erro de leitura propaga só o código", async () => {
    const { client } = fakeClient({ readError: { code: "42501", message: NAME } });
    await expect(loadOwnProfile(client, USER, deps().deps)).rejects.toThrow("profile_read_failed:42501");
  });
});

describe("hasOwnProfile e listMunicipalities", () => {
  it("diz se a pessoa já tem perfil", async () => {
    expect(await hasOwnProfile(fakeClient({ row: { id: USER } }).client, USER)).toBe(true);
    expect(await hasOwnProfile(fakeClient().client, USER)).toBe(false);
  });

  it("lista os municípios em ordem alfabética do português", async () => {
    const rows = [
      { code: 3550308, name: "São Paulo" },
      { code: 3503901, name: "Arujá" },
      { code: 3515004, name: "Embu das Artes" },
    ];
    expect((await listMunicipalities(fakeClient({ rows }).client)).map((m) => m.name)).toEqual([
      "Arujá",
      "Embu das Artes",
      "São Paulo",
    ]);
  });
});
