// Serviço do "Baixar meus dados" (#20): chama `export_own_data` com o cliente da pessoa,
// decifra de verdade (chave de teste) e nunca loga o conteúdo. O banco (só dados de quem
// chama, limite por hora) é testado em supabase/tests/export_own_data.test.sql.
import { describe, expect, it } from "vitest";
import { decryptWith, encryptWith, type FieldContext } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";
import { createLogger } from "@/server/log";
import { exportOwnData, type ExportDeps } from "./export";
import type { PrivacyDbClient } from "../types";

const key = () => crypto.getRandomValues(new Uint8Array(32));
const keyring = importKeyring({ fieldKeys: new Map([[1, key()]]), currentVersion: 1, blindIndexKey: key() });
const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
const NAME = "Maria Aparecida";
const PHONE = "+5511987654321";
const EMAIL = "maria@exemplo.org";

const enc = async (plain: string, table: string, column: string) => encryptWith(await keyring, plain, { table, column, rowId: USER });

async function dbRows() {
  return {
    profile: {
      display_name_enc: await enc(NAME, "profiles", "display_name_enc"),
      municipality_code: 3550308,
      municipality_name: "São Paulo",
      state_code: "SP",
      district_code: null,
      district_name: null,
      neighborhood_enc: null,
      status: "active",
      access_status: "active",
      consent_version: "none",
      consent_at: null,
      created_at: "2026-11-19T11:00:00+00:00",
      updated_at: "2026-11-19T11:00:00+00:00",
    },
    contact: {
      whatsapp_enc: await enc(PHONE, "profile_contacts", "whatsapp_enc"),
      social_links_enc: null,
      updated_at: "2026-11-19T11:00:00+00:00",
    },
    memberships: [],
    house_memberships: [],
    questionnaire_consents: [],
    questionnaire_result: null,
    house_analysis_requests: [],
    questionnaire_access_grants: [],
    consent_acceptances: [],
    roles: [],
    audit_events: [{ event: "data_exported", reason: null, term_version: null, house_key: null, created_at: "2026-11-19T12:00:00+00:00" }],
    contact_views: [],
  };
}

function setup(result: { data?: unknown; error?: unknown }) {
  const lines: string[] = [];
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: result.data ?? null, error: result.error ?? null };
    },
  } as unknown as PrivacyDbClient;
  const deps: ExportDeps = {
    decrypt: async (value: string, ctx: FieldContext) => decryptWith(await keyring, value, ctx),
    log: createLogger(undefined, (line) => lines.push(line)),
    now: () => new Date("2026-11-19T12:00:00Z"),
  };
  return { client, deps, lines, calls };
}

describe("exportOwnData", () => {
  it("decifra de verdade o totem e as respostas do questionário (AAD da linha da pessoa)", async () => {
    const base = await dbRows();
    const rows = {
      ...base,
      questionnaire_result: {
        house_key: "casa-qualquer",
        totem_enc: await enc("PA", "questionnaire_results", "totem_enc"),
        totem_state: "decided",
        scores_enc: await enc(JSON.stringify({ house1: -40, house2: 75, totem1: 0, totem2: -100 }), "questionnaire_results", "scores_enc"),
        term_version: "termo-1",
        source: "questionnaire",
        created_at: "2026-11-19T11:25:00+00:00",
      },
      house_analysis_requests: [
        {
          status: "open",
          resolution: null,
          term_version: "termo-1",
          tied_axes: ["house1"],
          answers_enc: await enc(JSON.stringify({ q01: -3, q02: 2 }), "house_analysis_requests", "answers_enc"),
          created_at: "2026-11-19T11:26:00+00:00",
          resolved_at: null,
        },
      ],
    };
    const { client, deps } = setup({ data: rows });
    const out = await exportOwnData(client, { id: USER, email: EMAIL }, deps);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    const file = JSON.parse(out.body);
    expect(file.resultadoDoQuestionario.totem).toBe("PA");
    expect(file.resultadoDoQuestionario.notasPorEixo).toEqual({ eixo1: -40, eixo2: 75, eixo3: 0, eixo4: -100 });
    expect(file.pedidosDeAnalise[0].respostas).toEqual({ q01: -3, q02: 2 });
    expect(out.body).not.toContain("totem_enc");
    expect(out.body).not.toContain("scores_enc");
  });

  it("devolve o arquivo decifrado e loga só o código do evento", async () => {
    const { client, deps, lines, calls } = setup({ data: await dbRows() });
    const out = await exportOwnData(client, { id: USER, email: EMAIL }, deps);
    expect(calls).toEqual([{ fn: "export_own_data", args: {} }]);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.filename).toBe("meus-dados-2026-11-19.json");
    const file = JSON.parse(out.body);
    expect(file.perfil.nome).toBe(NAME);
    expect(file.contato.whatsapp).toBe(PHONE);
    expect(file.conta.emailDeLogin).toBe(EMAIL);
    expect(file.sobre.descricao).toMatch(/\S/);
    // R11: nada do conteúdo no log.
    const logged = lines.join("");
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["data_exported"]);
    for (const secret of [NAME, PHONE, EMAIL, USER]) expect(logged).not.toContain(secret);
  });

  it("valor cifrado para outra pessoa (AAD de outro id) não decifra: campo nulo, log só da coluna", async () => {
    const rows = await dbRows();
    rows.profile.display_name_enc = await encryptWith(await keyring, NAME, {
      table: "profiles",
      column: "display_name_enc",
      rowId: "11111111-2222-4333-8444-555555555555",
    });
    const { client, deps, lines } = setup({ data: rows });
    const out = await exportOwnData(client, { id: USER, email: EMAIL }, deps);
    expect(out.status === "ok" && JSON.parse(out.body).perfil.nome).toBeNull();
    expect(lines.join("")).toContain('"column":"display_name_enc"');
    expect(lines.join("")).not.toContain(NAME);
  });

  it("6ª exportação na hora (erro 54000 do banco) volta rate_limited", async () => {
    const { client, deps, lines } = setup({ error: { code: "54000", message: "limite" } });
    expect(await exportOwnData(client, { id: USER, email: EMAIL }, deps)).toEqual({ status: "rate_limited" });
    expect(JSON.parse(lines[0]!).event).toBe("data_export_rate_limited");
  });

  it("sem sessão (42501) ou outro erro: failed, com só o código no log", async () => {
    const { client, deps, lines } = setup({ error: { code: "42501", message: `sem permissão ${EMAIL}` } });
    expect(await exportOwnData(client, { id: USER, email: EMAIL }, deps)).toEqual({ status: "failed" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "data_export_failed", reason: "42501" });
    expect(lines.join("")).not.toContain(EMAIL);
  });

  it("formato inesperado do banco: failed, sem valores no log", async () => {
    const { client, deps, lines } = setup({ data: { profile: { display_name_enc: 42 } } });
    expect(await exportOwnData(client, { id: USER, email: EMAIL }, deps)).toEqual({ status: "failed" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "data_export_failed", reason: "unexpected_shape" });
  });
});
