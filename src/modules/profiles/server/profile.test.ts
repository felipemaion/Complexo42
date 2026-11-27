// Serviço do formulário do perfil (#12): valida no servidor, cifra com AAD do id real da pessoa,
// calcula o HMAC aqui e chama `save_own_profile` com o JWT dela. O banco (permissão, formato,
// WhatsApp repetido) é testado em supabase/tests/profiles.test.sql.
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptWith, encryptWith, whatsappBlindIndexWith, type FieldContext } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";
import { createLogger } from "@/server/log";
import { hasOwnProfile, listDistricts, listMunicipalitiesByState, loadOwnProfile, saveOwnProfile, type ProfileDeps } from "./profile";
import type { ProfileDbClient } from "../types";

const key = () => crypto.getRandomValues(new Uint8Array(32));
const keyring = importKeyring({ fieldKeys: new Map([[1, key()]]), currentVersion: 1, blindIndexKey: key() });

const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
const SP = 3550308;
const SE_DISTRICT = 355030878;
const NAME = "Maria Aparecida";
const PHONE_TYPED = "(11) 98765-4321";
const PHONE = "+5511987654321";
const NEIGHBORHOOD = "Vila Exemplo";
const form = {
  displayName: NAME,
  whatsapp: PHONE_TYPED,
  municipalityCode: String(SP),
  district: String(SE_DISTRICT),
  neighborhood: NEIGHBORHOOD,
};

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
  const orders: { column: string; limit: number }[] = [];
  const reads: { table: string; columns: string; eq?: [string, string | number] }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      // Sem erro, a função devolve `saved` ou `duplicate_whatsapp` (#127).
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: "rpcData" in opts ? opts.rpcData : "saved", error: null };
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        // `.eq(...)` pode terminar a consulta (listas) ou seguir para `.maybeSingle()` (uma linha).
        eq: (column: string, value: string | number) => {
          reads.push({ table, columns, eq: [column, value] });
          const result = { data: opts.rows ?? [], error: opts.readError ?? null };
          return {
            maybeSingle: async () => ({ data: opts.row ?? null, error: opts.readError ?? null }),
            order: (orderColumn: string) => ({
              limit: async (max: number) => {
                orders.push({ column: orderColumn, limit: max });
                return result;
              },
            }),
          };
        },
      }),
    }),
  };
  return { client: client as unknown as ProfileDbClient, calls, reads, orders };
}

// Fragmentos longos: "4321" curto aparece por acaso no ciphertext/HMAC aleatório (teste instável).
const leaks = (text: string) => [NAME, "98765-4321", "987654321", PHONE].filter((secret) => text.includes(secret));

afterEach(() => vi.restoreAllMocks());

describe("saveOwnProfile", () => {
  it("cifra com AAD do id da pessoa, calcula o HMAC no servidor e chama save_own_profile", async () => {
    const { client, calls } = fakeClient();
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "saved" });
    expect(calls).toHaveLength(1);
    const { fn, args } = calls[0]!;
    expect(fn).toBe("save_own_profile");
    expect(args).toMatchObject({
      p_municipality_code: SP,
      p_district_code: SE_DISTRICT,
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

  it("cifra o bairro com o AAD da coluna e do id da pessoa; em branco vai nulo", async () => {
    const { client, calls } = fakeClient();
    const { deps: d } = deps();
    await saveOwnProfile(client, USER, { ...form, neighborhood: "  Vila   Exemplo " }, d);
    const sent = calls[0]!.args.p_neighborhood_enc as string;
    expect(sent).not.toContain("Vila");
    expect(await d.decrypt(sent, { table: "profiles", column: "neighborhood_enc", rowId: USER })).toBe(NEIGHBORHOOD);
    await expect(d.decrypt(sent, { table: "profiles", column: "display_name_enc", rowId: USER })).rejects.toThrow();
    await saveOwnProfile(client, USER, { ...form, neighborhood: "  " }, d);
    expect(calls[1]!.args.p_neighborhood_enc).toBeNull();
  });

  describe("bairro guardado (#179): envio sem o campo não o apaga", () => {
    const withoutNeighborhood = { ...form, neighborhood: undefined };
    const storedBairro = "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";

    it("formulário antigo ou valor que não abriu: repassa o cifrado guardado, sem abrir nem recifrar", async () => {
      const { client, calls, reads } = fakeClient({ row: { neighborhood_enc: storedBairro, social_links_enc: null } });
      const { deps: d } = deps();
      const encrypt = vi.spyOn(d, "encrypt");
      expect(await saveOwnProfile(client, USER, withoutNeighborhood, d)).toEqual({ status: "saved" });
      expect(calls[0]!.args.p_neighborhood_enc).toBe(storedBairro);
      expect(reads.some((read) => read.table === "profiles" && read.columns === "neighborhood_enc")).toBe(true);
      expect(encrypt.mock.calls.map(([, ctx]) => ctx.column)).not.toContain("neighborhood_enc");
    });

    it("sem bairro guardado, vai nulo", async () => {
      const { client, calls } = fakeClient({ row: { neighborhood_enc: null, social_links_enc: null } });
      await saveOwnProfile(client, USER, withoutNeighborhood, deps().deps);
      expect(calls[0]!.args.p_neighborhood_enc).toBeNull();
    });

    it("com o campo enviado vazio, o bairro é apagado de propósito", async () => {
      const { client, calls } = fakeClient({ row: { neighborhood_enc: storedBairro, social_links_enc: null } });
      await saveOwnProfile(client, USER, { ...form, neighborhood: "" }, deps().deps);
      expect(calls[0]!.args.p_neighborhood_enc).toBeNull();
    });

    it("erro ao ler o guardado: falha, sem chamar o banco de escrita", async () => {
      const { client, calls } = fakeClient({ readError: { code: "42501" } });
      expect(await saveOwnProfile(client, USER, withoutNeighborhood, deps().deps)).toEqual({ status: "failed" });
      expect(calls).toEqual([]);
    });
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
      [{ ...form, neighborhood: "Rua A, 12" }, ["neighborhood"]],
      [{}, ["displayName", "whatsapp", "municipalityCode"]],
    ] as const) {
      const result = await saveOwnProfile(client, USER, raw, d);
      expect(result).toEqual({ status: "invalid", fields });
    }
    expect(calls).toEqual([]);
    expect(encrypt).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("WhatsApp de outro cadastro (a função devolve duplicate_whatsapp): aviso, sem dizer de quem é", async () => {
    const { client } = fakeClient({ rpcData: "duplicate_whatsapp" });
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "duplicate_whatsapp" });
    expect(lines).toEqual([]);
  });

  it("limite de tentativas (PT429, #127): too_many_attempts, logado só o código", async () => {
    const { client } = fakeClient({ rpcError: { code: "PT429", message: "too_many_attempts", details: PHONE } });
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "too_many_attempts" });
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
      expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "failed" });
      expect(JSON.parse(lines[0]!)).toMatchObject({ event: "profile_save_failed", reason: "unexpected_result" });
    }
  });

  it("distrito que não é do município (PT422) volta como campo inválido", async () => {
    const { client } = fakeClient({ rpcError: { code: "PT422", message: "district_mismatch" } });
    expect(await saveOwnProfile(client, USER, form, deps().deps)).toEqual({ status: "invalid", fields: ["district"] });
  });

  it("município que o banco não conhece (23503) volta como campo inválido", async () => {
    const { client } = fakeClient({ rpcError: { code: "23503", message: "município desconhecido" } });
    expect(await saveOwnProfile(client, USER, form, deps().deps)).toEqual({
      status: "invalid",
      fields: ["municipalityCode"],
    });
  });

  it("sem permissão (bloqueado ou suspenso, 42501): forbidden, logado só o código", async () => {
    const { client } = fakeClient({ rpcError: { code: "42501", message: `sem permissão ${NAME}` } });
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "forbidden" });
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
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "failed" });
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
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "failed" });
    expect(calls).toEqual([]);
    expect(leaks(lines.join("\n"))).toEqual([]);
  });

  it("id de usuário que não é uuid é recusado antes de tudo", async () => {
    const { client, calls } = fakeClient();
    await expect(saveOwnProfile(client, "x.y", form, deps().deps)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("loadOwnProfile", () => {
  it("perfil incompleto (criado no primeiro login, ADR 0017): para o formulário é como não ter perfil, sem quebrar", async () => {
    const { deps: d } = deps();
    const row = { display_name_enc: null, municipality_code: null, state_code: null, district_code: null, neighborhood_enc: null, profile_completed_at: null, profile_contacts: null };
    expect(await loadOwnProfile(fakeClient({ row }).client, USER, d)).toBeNull();
  });

  it("decifra o próprio perfil com o id da pessoa", async () => {
    const { deps: d } = deps();
    const row = {
      display_name_enc: await d.encrypt(NAME, { table: "profiles", column: "display_name_enc", rowId: USER }),
      municipality_code: SP,
      state_code: "SP",
      district_code: SE_DISTRICT,
      neighborhood_enc: await d.encrypt(NEIGHBORHOOD, { table: "profiles", column: "neighborhood_enc", rowId: USER }),
      profile_completed_at: "2026-11-19T12:00:00+00:00",
      profile_contacts: { whatsapp_enc: await d.encrypt(PHONE, { table: "profile_contacts", column: "whatsapp_enc", rowId: USER }) },
    };
    const { client, reads } = fakeClient({ row });
    expect(await loadOwnProfile(client, USER, d)).toEqual({
      displayName: NAME,
      whatsapp: PHONE,
      municipalityCode: SP,
      stateCode: "SP",
      districtCode: SE_DISTRICT,
      neighborhood: NEIGHBORHOOD,
      neighborhoodUnreadable: false,
      socialLinks: [],
      socialLinksUnreadable: false,
    });
    expect(reads[0]).toMatchObject({ table: "profiles", eq: ["id", USER] });
  });

  it("bairro que não decifra: campo vazio, neighborhoodUnreadable, log sem o valor", async () => {
    const { deps: d, lines } = deps();
    const copied = await d.encrypt(NEIGHBORHOOD, { table: "profiles", column: "neighborhood_enc", rowId: "outra" });
    const row = {
      display_name_enc: await d.encrypt(NAME, { table: "profiles", column: "display_name_enc", rowId: USER }),
      municipality_code: SP,
      state_code: "SP",
      district_code: null,
      neighborhood_enc: copied,
      profile_contacts: null,
    };
    expect(await loadOwnProfile(fakeClient({ row }).client, USER, d)).toMatchObject({
      neighborhood: "",
      neighborhoodUnreadable: true,
    });
    expect(lines.filter((line) => line.includes("neighborhood_enc"))).toHaveLength(1);
    expect(lines.join("")).not.toContain(copied);
  });

  it("sem perfil devolve null; valor que não decifra vira campo vazio, sem logar o valor", async () => {
    const { deps: d, lines } = deps();
    expect(await loadOwnProfile(fakeClient().client, USER, d)).toBeNull();
    const copied = await d.encrypt(NAME, { table: "profiles", column: "display_name_enc", rowId: "outra" });
    const row = { display_name_enc: copied, municipality_code: SP, state_code: "SP", district_code: null, neighborhood_enc: null, profile_contacts: null };
    expect(await loadOwnProfile(fakeClient({ row }).client, USER, d)).toEqual({
      displayName: "",
      whatsapp: "",
      municipalityCode: SP,
      stateCode: "SP",
      districtCode: null,
      neighborhood: "",
      neighborhoodUnreadable: false,
      socialLinks: [],
      socialLinksUnreadable: false,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(copied);
  });

  it("erro de leitura propaga só o código", async () => {
    const { client } = fakeClient({ readError: { code: "42501", message: NAME } });
    await expect(loadOwnProfile(client, USER, deps().deps)).rejects.toThrow("profile_read_failed:42501");
  });
});

describe("redes sociais (#17)", () => {
  const LINKS = ["https://instagram.com/maria", "https://www.youtube.com/@maria"];
  const SOCIAL = { table: "profile_contacts", column: "social_links_enc", rowId: USER } as const;

  it("cifra a lista com AAD profile_contacts.social_links_enc.<id> e normaliza antes", async () => {
    const { client, calls, reads } = fakeClient();
    const { deps: d, lines } = deps();
    const typed = { ...form, socialLinks: ["  instagram.com/maria ", "", "HTTPS://WWW.YouTube.com/@maria"] };
    expect(await saveOwnProfile(client, USER, typed, d)).toEqual({ status: "saved" });
    const enc = calls[0]!.args.p_social_links_enc as string;
    expect(enc).not.toContain("instagram");
    expect(JSON.parse(await d.decrypt(enc, SOCIAL))).toEqual(LINKS);
    // Só abre com o contexto certo: outra pessoa ou outra coluna, não.
    await expect(d.decrypt(enc, { ...SOCIAL, rowId: "outra-pessoa" })).rejects.toThrow();
    await expect(d.decrypt(enc, { ...SOCIAL, column: "whatsapp_enc" })).rejects.toThrow();
    // Com os links no envio, não precisa ler o que está guardado.
    expect(reads).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("todas as caixas vazias (a pessoa tirou os links): grava null", async () => {
    const { client, calls } = fakeClient({ row: { social_links_enc: "v1.antigo" } });
    expect(await saveOwnProfile(client, USER, { ...form, socialLinks: ["", " "] }, deps().deps)).toEqual({
      status: "saved",
    });
    expect(calls[0]!.args.p_social_links_enc).toBeNull();
  });

  it("editar o perfil sem mexer nos links os mantém: os salvos voltam no formulário e são gravados de novo", async () => {
    const { deps: d } = deps();
    const stored = await d.encrypt(JSON.stringify(LINKS), SOCIAL);
    const row = {
      display_name_enc: await d.encrypt(NAME, { table: "profiles", column: "display_name_enc", rowId: USER }),
      municipality_code: SP,
      state_code: "SP",
      district_code: SE_DISTRICT,
      neighborhood_enc: null,
      profile_contacts: {
        whatsapp_enc: await d.encrypt(PHONE, { table: "profile_contacts", column: "whatsapp_enc", rowId: USER }),
        social_links_enc: stored,
      },
    };
    const own = await loadOwnProfile(fakeClient({ row }).client, USER, d);
    expect(own?.socialLinks).toEqual(LINKS);
    expect(own?.socialLinksUnreadable).toBe(false);
    // Muda só o nome e envia o resto como o formulário recebeu.
    const { client, calls } = fakeClient();
    const edited = { ...form, displayName: "Maria A. Souza", socialLinks: own!.socialLinks };
    expect(await saveOwnProfile(client, USER, edited, d)).toEqual({ status: "saved" });
    expect(JSON.parse(await d.decrypt(calls[0]!.args.p_social_links_enc as string, SOCIAL))).toEqual(LINKS);
  });

  it("envio sem os links (não veio do formulário atual): repassa o valor cifrado guardado, sem apagar", async () => {
    const { deps: d } = deps();
    const stored = await d.encrypt(JSON.stringify(LINKS), SOCIAL);
    const { client, calls, reads } = fakeClient({ row: { social_links_enc: stored } });
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "saved" });
    expect(reads).toEqual([{ table: "profile_contacts", columns: "social_links_enc", eq: ["profile_id", USER] }]);
    expect(calls[0]!.args.p_social_links_enc).toBe(stored);
  });

  it("envio sem os links e erro ao ler o guardado: failed, sem gravar (não apaga por engano)", async () => {
    const { client, calls } = fakeClient({ readError: { code: "XX000", message: "x" } });
    const { deps: d, lines } = deps();
    expect(await saveOwnProfile(client, USER, form, d)).toEqual({ status: "failed" });
    expect(calls).toEqual([]);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "profile_save_failed", reason: "XX000" });
  });

  it("link inválido: invalid com a posição da caixa, sem cifrar, sem chamar o banco e sem logar o link", async () => {
    const { client, calls } = fakeClient();
    const { deps: d, lines } = deps();
    const encrypt = vi.spyOn(d, "encrypt");
    const raw = { ...form, socialLinks: ["https://instagram.com/maria", "javascript:alert(1)"] };
    expect(await saveOwnProfile(client, USER, raw, d)).toEqual({
      status: "invalid",
      fields: ["socialLinks"],
      badLinks: [1],
    });
    expect(calls).toEqual([]);
    expect(encrypt).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("6 links: recusado", async () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://rede.example/p${i}`);
    const { client, calls } = fakeClient();
    expect(await saveOwnProfile(client, USER, { ...form, socialLinks: six }, deps().deps)).toEqual({
      status: "invalid",
      fields: ["socialLinks"],
    });
    expect(calls).toEqual([]);
  });

  describe("valor guardado que não abre inteiro (M1 da revisão): nunca é apagado por engano", () => {
    async function rowWith(social: string) {
      const { deps: d } = deps();
      return {
        display_name_enc: await d.encrypt(NAME, { table: "profiles", column: "display_name_enc", rowId: USER }),
        municipality_code: SP,
        state_code: "SP",
        district_code: SE_DISTRICT,
        neighborhood_enc: null,
        profile_contacts: {
          whatsapp_enc: await d.encrypt(PHONE, { table: "profile_contacts", column: "whatsapp_enc", rowId: USER }),
          social_links_enc: social,
        },
      };
    }

    it.each([
      ["não decifra (cifrado para outra pessoa)", async (d: ProfileDeps) => d.encrypt(JSON.stringify(LINKS), { ...SOCIAL, rowId: "outra" }), []],
      ["JSON quebrado", async (d: ProfileDeps) => d.encrypt("<script>", SOCIAL), []],
      [
        "link que não passa mais na regra",
        async (d: ProfileDeps) => d.encrypt(JSON.stringify(["javascript:alert(1)", "https://instagram.com/maria", "data:text/html,x"]), SOCIAL),
        ["https://instagram.com/maria"],
      ],
    ] as const)("%s: socialLinksUnreadable, só os links que abriram, log sem o valor", async (_name, make, readable) => {
      const { deps: d, lines } = deps();
      const stored = await make(d);
      const own = await loadOwnProfile(fakeClient({ row: await rowWith(stored) }).client, USER, d);
      expect(own?.socialLinks).toEqual(readable);
      expect(own?.socialLinksUnreadable).toBe(true);
      expect(own?.displayName).toBe(NAME);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ event: "profile_decrypt_failed", column: "social_links_enc" });
      expect(lines[0]).not.toMatch(/script|alert|instagram/);
      expect(lines[0]).not.toContain(stored);
    });

    it("valor ilegível + salvar só o nome (o formulário não envia os links): o cifrado guardado fica igual", async () => {
      const { deps: d } = deps();
      const stored = await d.encrypt("<script>", SOCIAL);
      const own = await loadOwnProfile(fakeClient({ row: await rowWith(stored) }).client, USER, d);
      expect(own?.socialLinksUnreadable).toBe(true);
      // Sem o campo escondido, o envio chega sem `socialLinks` (ver actions.ts).
      const { client, calls } = fakeClient({ row: { social_links_enc: stored } });
      const onlyName = { ...form, displayName: "Maria A. Souza" };
      expect(await saveOwnProfile(client, USER, onlyName, d)).toEqual({ status: "saved" });
      expect(calls[0]!.args.p_social_links_enc).toBe(stored);
    });
  });
});

describe("hasOwnProfile e listMunicipalities", () => {
  it("diz se a pessoa já tem perfil", async () => {
    expect(await hasOwnProfile(fakeClient({ row: { id: USER } }).client, USER)).toBe(true);
    expect(await hasOwnProfile(fakeClient().client, USER)).toBe(false);
  });

  it("lista os municípios da UF em ordem alfabética do português", async () => {
    const rows = [
      { code: 3550308, name: "São Paulo" },
      { code: 3503901, name: "Arujá" },
      { code: 3515004, name: "Embu das Artes" },
    ];
    const { client, reads, orders } = fakeClient({ rows });
    expect((await listMunicipalitiesByState(client, "SP")).map((m) => m.name)).toEqual(["Arujá", "Embu das Artes", "São Paulo"]);
    expect(reads[0]).toMatchObject({ table: "municipalities", eq: ["state_code", "SP"] });
    expect(orders).toEqual([{ column: "name", limit: 1000 }]);
  });

  it("recusa UF fora do formato antes de consultar o banco", async () => {
    const { client, reads } = fakeClient();
    await expect(listMunicipalitiesByState(client, "sp; drop")).rejects.toThrow();
    expect(reads).toEqual([]);
  });

  it("erro de leitura sobe, em vez de lista vazia", async () => {
    const { client } = fakeClient({ readError: { code: "42501" } });
    await expect(listMunicipalitiesByState(client, "SP")).rejects.toThrow("municipalities_read_failed:42501");
    await expect(listDistricts(client, SP)).rejects.toThrow("districts_read_failed:42501");
  });
});

describe("listDistricts", () => {
  it("lista os distritos do município em ordem alfabética do português", async () => {
    const rows = [
      { code: 355030883, name: "Vila Mariana" },
      { code: 355030801, name: "Água Rasa" },
      { code: 355030802, name: "Alto de Pinheiros" },
    ];
    const { client, reads, orders } = fakeClient({ rows });
    expect((await listDistricts(client, SP)).map((d) => d.name)).toEqual(["Água Rasa", "Alto de Pinheiros", "Vila Mariana"]);
    expect(reads[0]).toMatchObject({ table: "districts", eq: ["municipality_code", SP] });
    expect(orders).toEqual([{ column: "name", limit: 1000 }]);
  });

  it("recusa código de município fora do formato", async () => {
    await expect(listDistricts(fakeClient().client, 12)).rejects.toThrow();
  });
});
