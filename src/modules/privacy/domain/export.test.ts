// Arquivo do "Baixar meus dados" (#20): todo campo do banco chega ao arquivo, decifrado com o
// AAD certo; nada de HMAC nem id; falha de decifragem vira null sem derrubar o resto.
import { describe, expect, it, vi } from "vitest";
import {
  buildOwnDataExport,
  exportFilename,
  isSameOrigin,
  ownDataRowsSchema,
  parseMyDataStatus,
  serializeExport,
  type CipherContext,
  type OwnDataRows,
} from "./export";

const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
const AT = new Date("2026-11-20T01:30:00Z"); // 22h30 de 19/11 em Brasília
const VIEWER = "7d1c0a2b-9e8f-4a6b-8c5d-3e2f1a0b9c8d";

const rows: OwnDataRows = {
  profile: {
    display_name_enc: "enc:nome",
    municipality_code: 3550308,
    municipality_name: "São Paulo",
    state_code: "SP",
    district: "Sé",
    status: "active",
    access_status: "active",
    consent_version: "v1",
    consent_at: "2026-11-19T12:00:00+00:00",
    created_at: "2026-11-19T11:00:00+00:00",
    updated_at: "2026-11-19T12:00:00+00:00",
  },
  contact: {
    whatsapp_enc: "enc:zap",
    social_links_enc: "enc:redes",
    updated_at: "2026-11-19T12:00:00+00:00",
  },
  memberships: [
    { unit_name: "São Paulo", unit_type: "Estado", member_role: "member", joined_at: "2026-11-19T11:00:00+00:00", left_at: null },
  ],
  house_memberships: [
    {
      house_key: "casa-um",
      join_method: "questionnaire",
      consent_version: "termo-1",
      joined_at: "2026-11-19T11:30:00+00:00",
      accepted_at: "2026-11-19T11:30:00+00:00",
      left_at: null,
    },
  ],
  questionnaire_consents: [{ term_version: "termo-1", consented_at: "2026-11-19T11:20:00+00:00" }],
  roles: [
    { role: "spokesperson", unit_name: "Equipe 1", unit_type: "Equipe", house_key: null, granted_at: "2026-11-19T13:00:00+00:00", revoked_at: null },
    { role: "house_coordinator", unit_name: "Região 1", unit_type: "Região", house_key: "casa-fora-da-config", granted_at: "2026-11-19T14:00:00+00:00", revoked_at: null },
  ],
  audit_events: [
    { event: "questionnaire_consented", reason: null, term_version: "termo-1", house_key: null, created_at: "2026-11-19T11:20:00+00:00" },
    { event: "house_accepted", reason: "questionnaire", term_version: "termo-1", house_key: "casa-um", created_at: "2026-11-19T11:30:00+00:00" },
    { event: "data_exported", reason: null, term_version: null, house_key: null, created_at: "2026-11-20T01:30:00+00:00" },
  ],
  contact_views: [
    { viewer_id: VIEWER, viewer_name_enc: "enc:quemviu", kind: "whatsapp", viewed_at: "2026-11-19T15:00:00+00:00" },
    { viewer_id: null, viewer_name_enc: null, kind: "email", viewed_at: "2026-11-19T16:00:00+00:00" },
  ],
};

const plain: Record<string, string> = {
  "enc:nome": "Maria Aparecida",
  "enc:zap": "+5511987654321",
  "enc:redes": JSON.stringify(["https://exemplo.org/maria"]),
  "enc:quemviu": "Joana Coordena",
};

function fakeDecrypt() {
  const seen: CipherContext[] = [];
  const decrypt = vi.fn(async (value: string, ctx: CipherContext) => {
    seen.push(ctx);
    const out = plain[value];
    if (out === undefined) throw new Error("decrypt_failed");
    return out;
  });
  return { decrypt, seen };
}

const build = (over: Partial<Parameters<typeof buildOwnDataExport>[0]> = {}) =>
  buildOwnDataExport({
    rows,
    userId: USER,
    loginEmail: "maria@exemplo.org",
    generatedAt: AT,
    description: "Cópia dos seus dados.",
    houseNames: { "casa-um": "Casa Um" },
    decrypt: fakeDecrypt().decrypt,
    ...over,
  });

describe("buildOwnDataExport", () => {
  it("traz todos os campos, decifrados, com as chaves em português", async () => {
    expect(await build()).toEqual({
      sobre: { formato: 3, geradoEm: "2026-11-20T01:30:00.000Z", descricao: "Cópia dos seus dados." },
      conta: { emailDeLogin: "maria@exemplo.org" },
      perfil: {
        nome: "Maria Aparecida",
        municipio: { codigoIbge: 3550308, nome: "São Paulo", uf: "SP" },
        distrito: "Sé",
        situacaoDaConta: "active",
        liberacaoDeAcesso: "active",
        termoDeConsentimento: { versao: "v1", aceitoEm: "2026-11-19T12:00:00+00:00" },
        criadoEm: "2026-11-19T11:00:00+00:00",
        atualizadoEm: "2026-11-19T12:00:00+00:00",
      },
      contato: { whatsapp: "+5511987654321", redesSociais: ["https://exemplo.org/maria"], atualizadoEm: "2026-11-19T12:00:00+00:00" },
      vinculos: [{ unidade: "São Paulo", tipo: "Estado", papelNoGrupo: "member", entrouEm: "2026-11-19T11:00:00+00:00", saiuEm: null }],
      casas: [
        {
          casa: "Casa Um",
          formaDeEntrada: "questionnaire",
          versaoDoTermo: "termo-1",
          entrouEm: "2026-11-19T11:30:00+00:00",
          aceitaEm: "2026-11-19T11:30:00+00:00",
          saiuEm: null,
        },
      ],
      termosDoQuestionario: [{ versao: "termo-1", aceitoEm: "2026-11-19T11:20:00+00:00" }],
      papeis: [
        { papel: "spokesperson", unidade: "Equipe 1", tipo: "Equipe", casa: null, concedidoEm: "2026-11-19T13:00:00+00:00", revogadoEm: null },
        // Casa que não está mais na config: aparece pela chave.
        { papel: "house_coordinator", unidade: "Região 1", tipo: "Região", casa: "casa-fora-da-config", concedidoEm: "2026-11-19T14:00:00+00:00", revogadoEm: null },
      ],
      registrosSobreVoce: [
        { evento: "questionnaire_consented", motivo: null, versaoDoTermo: "termo-1", casa: null, em: "2026-11-19T11:20:00+00:00" },
        { evento: "house_accepted", motivo: "questionnaire", versaoDoTermo: "termo-1", casa: "Casa Um", em: "2026-11-19T11:30:00+00:00" },
        { evento: "data_exported", motivo: null, versaoDoTermo: null, casa: null, em: "2026-11-20T01:30:00+00:00" },
      ],
      quemViuSeuContato: [
        { quem: "Joana Coordena", contato: "whatsapp", em: "2026-11-19T15:00:00+00:00" },
        { quem: null, contato: "email", em: "2026-11-19T16:00:00+00:00" },
      ],
    });
  });

  it("decifra cada campo com o AAD da sua coluna e do id da pessoa (ADR 0003)", async () => {
    const { decrypt, seen } = fakeDecrypt();
    await build({ decrypt });
    expect(seen).toEqual(
      expect.arrayContaining([
        { table: "profiles", column: "display_name_enc", rowId: USER },
        { table: "profile_contacts", column: "whatsapp_enc", rowId: USER },
        { table: "profile_contacts", column: "social_links_enc", rowId: USER },
        // O nome de quem viu o contato é da linha dela (#119).
        { table: "profiles", column: "display_name_enc", rowId: VIEWER },
      ]),
    );
    expect(seen).toHaveLength(4);
  });

  it("não leva HMAC, valor cifrado nem o id interno, mesmo se o banco mandar a mais", async () => {
    const extra = {
      ...rows,
      contact: { ...rows.contact, whatsapp_hmac: "a".repeat(64) },
      profile: { ...rows.profile, id: USER },
    };
    const text = serializeExport(await build({ rows: ownDataRowsSchema.parse(extra) }));
    expect(text).not.toMatch(/hmac/i);
    expect(text).not.toContain("a".repeat(64));
    expect(text).not.toContain("enc:");
    expect(text).not.toContain(USER);
    expect(text).not.toContain(VIEWER);
  });

  it("nome de quem viu que não decifra vira null e avisa só a coluna (#119)", async () => {
    const onDecryptError = vi.fn();
    const broken = { ...rows, contact_views: [{ ...rows.contact_views[0]!, viewer_name_enc: "enc:estragado" }] };
    const out = await build({ rows: broken, onDecryptError });
    expect(out.quemViuSeuContato).toEqual([{ quem: null, contato: "whatsapp", em: "2026-11-19T15:00:00+00:00" }]);
    expect(onDecryptError).toHaveBeenCalledWith("viewer_name_enc", expect.any(Error));
  });

  it("valor que não decifra vira null, avisa só a coluna e o resto do arquivo sai", async () => {
    const onDecryptError = vi.fn();
    const broken = { ...rows, profile: { ...rows.profile!, display_name_enc: "enc:estragado" } };
    const out = await build({ rows: broken, onDecryptError });
    expect(out.perfil?.nome).toBeNull();
    expect(out.contato?.whatsapp).toBe("+5511987654321");
    expect(onDecryptError).toHaveBeenCalledWith("display_name_enc", expect.any(Error));
  });

  it("redes que não são uma lista de textos viram null", async () => {
    const onDecryptError = vi.fn();
    const decrypt = async (v: string) => (v === "enc:redes" ? "{nao é json" : (plain[v] ?? ""));
    const out = await build({ decrypt, onDecryptError });
    expect(out.contato?.redesSociais).toBeNull();
    expect(onDecryptError).toHaveBeenCalledWith("social_links_enc", expect.anything());
  });

  it("sem redes cadastradas: lista vazia; sem aceite do termo: versão e data nulas", async () => {
    const out = await build({
      rows: {
        ...rows,
        profile: { ...rows.profile!, consent_version: "none", consent_at: "2026-11-19T11:00:00+00:00" },
        contact: { ...rows.contact!, social_links_enc: null },
      },
    });
    expect(out.contato?.redesSociais).toEqual([]);
    expect(out.perfil?.termoDeConsentimento).toEqual({ versao: null, aceitoEm: null });
  });

  it("quem ainda não tem perfil recebe perfil e contato nulos e listas vazias", async () => {
    const out = await build({
      rows: {
        profile: null,
        contact: null,
        memberships: [],
        house_memberships: [],
        questionnaire_consents: [],
        roles: [],
        audit_events: [],
        contact_views: [],
      },
      loginEmail: null,
    });
    expect(out).toMatchObject({
      conta: { emailDeLogin: null },
      perfil: null,
      contato: null,
      vinculos: [],
      casas: [],
      termosDoQuestionario: [],
      papeis: [],
      registrosSobreVoce: [],
      quemViuSeuContato: [],
    });
  });
});

describe("ownDataRowsSchema", () => {
  it("recusa um formato inesperado do banco", () => {
    expect(ownDataRowsSchema.safeParse({ profile: null }).success).toBe(false);
  });
});

describe("serializeExport", () => {
  it("JSON indentado, em UTF-8 sem escapar acentos, terminando em quebra de linha", async () => {
    const text = serializeExport(await build());
    expect(text).toContain('\n  "perfil": {');
    expect(text).toContain("São Paulo");
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text).perfil.nome).toBe("Maria Aparecida");
  });
});

describe("exportFilename", () => {
  it("usa a data de Brasília", () => {
    expect(exportFilename(AT)).toBe("meus-dados-2026-11-19.json");
    expect(exportFilename(new Date("2026-11-20T03:00:00Z"))).toBe("meus-dados-2026-11-20.json");
  });
});

describe("isSameOrigin", () => {
  it("aceita só a origem do site", () => {
    expect(isSameOrigin("https://app.exemplo.org", "https://app.exemplo.org")).toBe(true);
    expect(isSameOrigin("https://mal.exemplo", "https://app.exemplo.org")).toBe(false);
    expect(isSameOrigin("http://app.exemplo.org", "https://app.exemplo.org")).toBe(false);
    expect(isSameOrigin(null, "https://app.exemplo.org")).toBe(false);
    expect(isSameOrigin("null", "https://app.exemplo.org")).toBe(false);
  });
});

describe("parseMyDataStatus", () => {
  it("só os códigos conhecidos", () => {
    expect(parseMyDataStatus("limite")).toBe("limite");
    expect(parseMyDataStatus("erro")).toBe("erro");
    expect(parseMyDataStatus("<script>")).toBeNull();
    expect(parseMyDataStatus(["erro"])).toBeNull();
  });
});
