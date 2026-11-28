// Contato no servidor (#119, ADR 0010): a decisão e o registro são do banco (testados em
// supabase/tests/contact_visibility.test.sql e permissions_matrix.test.sql). Aqui: o servidor
// chama as funções certas com o JWT da pessoa, decifra com o AAD da linha do alvo, deixa de
// fora o que foi negado e não põe nenhum valor de contato ou nome no log (R11).
import { describe, expect, it } from "vitest";
import { decryptWith, encryptWith, type FieldContext } from "@/server/crypto/field";
import { importKeyring } from "@/server/crypto/keys";
import { createLogger } from "@/server/log";
import { listContactViews, loadContactVisibility, readContactAccess, setContactVisibility, viewMemberContact, type ContactDeps } from "./contact";
import type { ProfileDbClient } from "../types";

const key = () => crypto.getRandomValues(new Uint8Array(32));
const keyring = importKeyring({ fieldKeys: new Map([[1, key()]]), currentVersion: 1, blindIndexKey: key() });

const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
const TARGET = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const VIEWER = "7d1c0a2b-9e8f-4a6b-8c5d-3e2f1a0b9c8d";
const PHONE = "+5511987654321";
const EMAIL = "joana.alvo@exemplo.org";
const LINK = "https://exemplo.org/joana";
const NAME = "Joana Coordena";

const enc = async (plain: string, ctx: FieldContext) => encryptWith(await keyring, plain, ctx);

function deps(): { deps: ContactDeps; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    deps: {
      decrypt: async (value: string, ctx: FieldContext) => decryptWith(await keyring, value, ctx),
      log: createLogger(undefined, (line) => lines.push(line)),
    },
  };
}

type Rpc = (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown };

function fakeClient(rpc: Rpc, rows: unknown = []) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const reads: { table: string; columns: string; eq: [string, string] }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return rpc(fn, args);
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: async (column: string, value: string) => {
          reads.push({ table, columns, eq: [column, value] });
          return { data: rows, error: null };
        },
      }),
    }),
  };
  return { client: client as unknown as ProfileDbClient, calls, reads };
}

const denied = { data: null, error: { code: "42501", message: `sem permissão para ${EMAIL}` } };
const leaks = (text: string) => [PHONE, "98765", EMAIL, LINK, NAME, "Joana"].filter((s) => text.includes(s));

describe("viewMemberContact", () => {
  it("pede ao banco só o tipo que a tela quer e decifra com o AAD da linha do alvo", async () => {
    const whatsappEnc = await enc(PHONE, { table: "profile_contacts", column: "whatsapp_enc", rowId: TARGET });
    const { client, calls } = fakeClient(() => ({ data: whatsappEnc, error: null }));
    const { deps: d, lines } = deps();

    expect(await viewMemberContact(client, TARGET, "whatsapp", d)).toEqual({ status: "ok", contact: { whatsapp: PHONE } });
    expect(calls).toEqual([{ fn: "view_contact", args: { p_target: TARGET, p_kind: "whatsapp" } }]);
    expect(leaks(lines.join(""))).toEqual([]);
  });

  it("redes: decifra a lista; e-mail: vem como está", async () => {
    const socialEnc = await enc(JSON.stringify([LINK]), { table: "profile_contacts", column: "social_links_enc", rowId: TARGET });
    const social = fakeClient(() => ({ data: socialEnc, error: null }));
    expect(await viewMemberContact(social.client, TARGET, "social", deps().deps)).toEqual({ status: "ok", contact: { social: [LINK] } });
    const email = fakeClient(() => ({ data: EMAIL, error: null }));
    const { deps: d, lines } = deps();
    expect(await viewMemberContact(email.client, TARGET, "email", d)).toEqual({ status: "ok", contact: { email: EMAIL } });
    expect(email.calls).toEqual([{ fn: "view_contact", args: { p_target: TARGET, p_kind: "email" } }]);
    expect(leaks(lines.join(""))).toEqual([]);
  });

  it("sem valor cadastrado: null (o banco não registra acesso)", async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    expect(await viewMemberContact(client, TARGET, "social", deps().deps)).toEqual({ status: "ok", contact: { social: null } });
  });

  it("negado: forbidden, sem valor nenhum", async () => {
    const { client } = fakeClient(() => denied);
    const { deps: d, lines } = deps();
    expect(await viewMemberContact(client, TARGET, "email", d)).toEqual({ status: "forbidden" });
    expect(leaks(lines.join(""))).toEqual([]);
  });

  it("limite de pessoas por hora: rate_limited", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: "54000", message: `limite ${EMAIL}` } }));
    const { deps: d, lines } = deps();
    expect(await viewMemberContact(client, TARGET, "whatsapp", d)).toEqual({ status: "rate_limited" });
    expect(lines.join("")).toContain("contact_view_rate_limited");
    expect(leaks(lines.join(""))).toEqual([]);
  });

  it("id que não é uuid, ou tipo desconhecido, nem chega ao banco", async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    expect(await viewMemberContact(client, "1 or 1=1", "whatsapp", deps().deps)).toEqual({ status: "forbidden" });
    expect(await viewMemberContact(client, TARGET, "telefone" as never, deps().deps)).toEqual({ status: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("valor cifrado para outra linha (AAD errado) vira null e o log tem só a coluna", async () => {
    const otherRow = await enc(PHONE, { table: "profile_contacts", column: "whatsapp_enc", rowId: USER });
    const { client } = fakeClient(() => ({ data: otherRow, error: null }));
    const { deps: d, lines } = deps();
    expect(await viewMemberContact(client, TARGET, "whatsapp", d)).toEqual({ status: "ok", contact: { whatsapp: null } });
    expect(lines.join("")).toContain("contact_decrypt_failed");
    expect(lines.join("")).toContain("whatsapp_enc");
    expect(leaks(lines.join(""))).toEqual([]);
  });

  it("erro inesperado do banco: failed, só o código no log", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: "XX000", message: `falhou com ${PHONE}` } }));
    const { deps: d, lines } = deps();
    expect(await viewMemberContact(client, TARGET, "whatsapp", d)).toEqual({ status: "failed" });
    expect(lines.join("")).toContain("XX000");
    expect(leaks(lines.join(""))).toEqual([]);
  });
});

describe("setContactVisibility", () => {
  it("valida e chama set_contact_visibility", async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    expect(await setContactVisibility(client, { kind: "email", scope: "team_house" })).toEqual({ status: "saved" });
    expect(calls).toEqual([{ fn: "set_contact_visibility", args: { p_kind: "email", p_scope: "team_house" } }]);
  });

  it("escolha inválida nem chega ao banco", async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    expect(await setContactVisibility(client, { kind: "email", scope: "todos" })).toEqual({ status: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("negado pelo banco: forbidden; outro erro: failed", async () => {
    const { deps: d } = deps();
    expect(await setContactVisibility(fakeClient(() => denied).client, { kind: "email", scope: "team" }, d)).toEqual({
      status: "forbidden",
    });
    const broken = fakeClient(() => ({ data: null, error: { code: "XX000" } })).client;
    expect(await setContactVisibility(broken, { kind: "email", scope: "team" }, d)).toEqual({ status: "failed" });
  });
});

describe("loadContactVisibility", () => {
  it("lê só as linhas da própria pessoa e completa com none", async () => {
    const { client, reads } = fakeClient(() => ({ data: null, error: null }), [{ kind: "whatsapp", scope: "team" }]);
    expect(await loadContactVisibility(client, USER)).toEqual({ whatsapp: "team", social: "none", email: "none" });
    expect(reads).toEqual([{ table: "contact_visibility", columns: "kind, scope", eq: ["profile_id", USER] }]);
  });
});

describe("listContactViews", () => {
  it("decifra o nome de quem viu com o AAD da linha dela; conta excluída fica sem nome", async () => {
    const nameEnc = await enc(NAME, { table: "profiles", column: "display_name_enc", rowId: VIEWER });
    const rows = [
      { viewer_id: VIEWER, viewer_name_enc: nameEnc, kind: "whatsapp", viewed_at: "2026-11-19T16:00:00+00:00" },
      { viewer_id: VIEWER, viewer_name_enc: nameEnc, kind: "email", viewed_at: "2026-11-19T15:00:00+00:00" },
      { viewer_id: null, viewer_name_enc: null, kind: "social", viewed_at: "2026-11-19T14:00:00+00:00" },
    ];
    const { client, calls } = fakeClient(() => ({ data: rows, error: null }));
    const { deps: d, lines } = deps();
    expect(await listContactViews(client, d)).toEqual([
      { viewerName: NAME, kind: "whatsapp", viewedAt: "2026-11-19T16:00:00+00:00" },
      { viewerName: NAME, kind: "email", viewedAt: "2026-11-19T15:00:00+00:00" },
      { viewerName: null, kind: "social", viewedAt: "2026-11-19T14:00:00+00:00" },
    ]);
    expect(calls).toEqual([{ fn: "list_contact_views", args: {} }]);
    expect(leaks(lines.join(""))).toEqual([]);
  });

  it("nome que não decifra vira null, sem o valor no log", async () => {
    const wrong = await enc(NAME, { table: "profiles", column: "display_name_enc", rowId: USER });
    const rows = [{ viewer_id: VIEWER, viewer_name_enc: wrong, kind: "whatsapp", viewed_at: "2026-11-19T16:00:00+00:00" }];
    const { deps: d, lines } = deps();
    expect(await listContactViews(fakeClient(() => ({ data: rows, error: null })).client, d)).toEqual([
      { viewerName: null, kind: "whatsapp", viewedAt: "2026-11-19T16:00:00+00:00" },
    ]);
    expect(lines.join("")).toContain("contact_views_decrypt_failed");
    expect(leaks(lines.join(""))).toEqual([]);
  });
});

describe("readContactAccess", () => {
  it("chama contact_access com o alvo e devolve só as permissões", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ whatsapp_ok: true, social_ok: false, login_ok: true }], error: null }));
    expect(await readContactAccess(client, TARGET)).toEqual({ whatsapp: true, social: false, email: true });
    expect(calls).toEqual([{ fn: "contact_access", args: { p_target: TARGET } }]);
  });

  it("erro, resposta estranha ou id inválido: nenhum botão, e id inválido nem chama o banco", async () => {
    const none = { whatsapp: false, social: false, email: false };
    expect(await readContactAccess(fakeClient(() => denied).client, TARGET)).toEqual(none);
    expect(await readContactAccess(fakeClient(() => ({ data: [{ whatsapp_ok: "sim" }], error: null })).client, TARGET)).toEqual(none);
    const spy = fakeClient(() => ({ data: [], error: null }));
    expect(await readContactAccess(spy.client, "nao-e-uuid")).toEqual(none);
    expect(spy.calls).toEqual([]);
  });
});
