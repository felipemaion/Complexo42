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
      district: null,
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
    consent_acceptances: [],
    roles: [],
    audit_events: [{ event: "data_exported", reason: null, term_version: null, house_key: null, created_at: "2026-11-19T12:00:00+00:00" }],
    contact_views: [],
  };
}

// Atividade (medalhas, portfólio, pontos, entregas, mensagens): função irmã export_own_activity.
const EMPTY_ACTIVITY = { badges: [], portfolio: [], points_total: 0, points: [], submissions: [], team_messages: [], prior_teams: [], skills: [] };

function setup(result: { data?: unknown; error?: unknown }, activity: { data?: unknown; error?: unknown } = { data: EMPTY_ACTIVITY }) {
  const lines: string[] = [];
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      const answer = fn === "export_own_activity" ? activity : result;
      return { data: answer.data ?? null, error: answer.error ?? null };
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
  it("devolve o arquivo decifrado e loga só o código do evento", async () => {
    const { client, deps, lines, calls } = setup({ data: await dbRows() });
    const out = await exportOwnData(client, { id: USER, email: EMAIL }, deps);
    expect(calls).toEqual([
      { fn: "export_own_data", args: {} },
      { fn: "export_own_activity", args: {} },
    ]);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.filename).toBe("meus-dados-2026-11-19.json");
    const file = JSON.parse(out.body);
    expect(file.atividade.pontos.total).toBe(0);
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

  it("falha na parte da atividade: failed (nunca um arquivo incompleto sem aviso)", async () => {
    const { client, deps, lines } = setup({ data: await dbRows() }, { error: { code: "42883", message: "x" } });
    expect(await exportOwnData(client, { id: USER, email: EMAIL }, deps)).toEqual({ status: "failed" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "data_export_failed", reason: "activity_42883" });
  });

  it("formato inesperado do banco: failed, sem valores no log", async () => {
    const { client, deps, lines } = setup({ data: { profile: { display_name_enc: 42 } } });
    expect(await exportOwnData(client, { id: USER, email: EMAIL }, deps)).toEqual({ status: "failed" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "data_export_failed", reason: "unexpected_shape" });
  });
});
