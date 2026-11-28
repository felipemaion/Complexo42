import { describe, expect, it } from "vitest";
import type { HouseClient, HouseQuery } from "@/modules/houses";
import { decideSuggestion, listCatalog, listMySuggestions, listOpenSuggestions, readMySkillIds, setMySkills, suggestSkill } from "./skills";

type Call = { fn: string; args: Record<string, unknown> };
const ID = "8f1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e6f";
const ID2 = "9a1c2a4e-0b5d-4c3a-9e7f-1a2b3c4d5e70";

function fake(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Call[] = [];
  const filters: unknown[][] = [];
  const response = { data: result.data ?? null, error: result.error ?? null };
  const query: HouseQuery = {
    eq: (...a) => (filters.push(["eq", ...a]), query),
    is: (...a) => (filters.push(["is", ...a]), query),
    not: (...a) => (filters.push(["not", ...a]), query),
    neq: (...a) => (filters.push(["neq", ...a]), query),
    in: (...a) => (filters.push(["in", ...a]), query),
    order: (...a) => (filters.push(["order", ...a]), query),
    limit: (...a) => (filters.push(["limit", ...a]), query),
    maybeSingle: () => Promise.resolve(response),
    then: (ok, fail) => Promise.resolve(response).then(ok, fail),
  };
  const client: HouseClient = {
    rpc: (fn, args) => (calls.push({ fn, args }), Promise.resolve(response)),
    from: (table) => ({ select: (columns) => (filters.push(["from", table, columns]), query) }),
  };
  return { client, calls, filters };
}

describe("setMySkills", () => {
  it("manda ao banco só os ids (o banco confere a pessoa, o limite e as inativas)", async () => {
    const { client, calls } = fake({ data: 2 });
    expect(await setMySkills(client, { skillIds: [ID, ID2] })).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "set_my_skills", args: { p_skill_ids: [ID, ID2] } }]);
  });

  it("mais de 10, id malformado ou campo a mais: recusa sem chamar o banco", async () => {
    const { client, calls } = fake();
    const eleven = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await setMySkills(client, { skillIds: eleven })).toEqual({ ok: false, error: "limit" });
    expect(await setMySkills(client, { skillIds: ["x"] })).toEqual({ ok: false, error: "invalid" });
    expect(await setMySkills(client, { skillIds: [], extra: 1 })).toEqual({ ok: false, error: "invalid" });
    expect(calls).toEqual([]);
  });

  it("traduz o código do banco, sem repassar a mensagem", async () => {
    expect(await setMySkills(fake({ error: { code: "C7701", message: "detalhe interno" } }).client, { skillIds: [ID] })).toEqual({ ok: false, error: "limit" });
    expect(await setMySkills(fake({ error: { code: "P0002" } }).client, { skillIds: [ID] })).toEqual({ ok: false, error: "not_found" });
    expect(await setMySkills(fake({ error: { code: "42501" } }).client, { skillIds: [ID] })).toEqual({ ok: false, error: "forbidden" });
    expect(await setMySkills(fake({ error: { code: "XX000" } }).client, { skillIds: [ID] })).toEqual({ ok: false, error: "failed" });
  });
});

describe("suggestSkill", () => {
  it("valida o nome no servidor e manda só o nome limpo", async () => {
    const { client, calls } = fake({ data: ID });
    expect(await suggestSkill(client, { name: "  Jardinagem   urbana " })).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "suggest_skill", args: { p_name: "Jardinagem urbana" } }]);
  });

  it("nome com invisível ou controle, curto ou campo a mais: recusa sem chamar o banco", async () => {
    const { client, calls } = fake();
    expect(await suggestSkill(client, { name: "Ma​ria" })).toEqual({ ok: false, error: "invalid" });
    expect(await suggestSkill(client, { name: "a" })).toEqual({ ok: false, error: "invalid" });
    expect(await suggestSkill(client, { name: "Teatro", extra: 1 })).toEqual({ ok: false, error: "invalid" });
    expect(calls).toEqual([]);
  });

  it("traduz os limites e o já existente", async () => {
    const code = async (c: string) => suggestSkill(fake({ error: { code: c } }).client, { name: "Teatro de rua" });
    expect(await code("C7702")).toEqual({ ok: false, error: "too_many_open" });
    expect(await code("C7703")).toEqual({ ok: false, error: "daily_limit" });
    expect(await code("C7704")).toEqual({ ok: false, error: "exists" });
  });
});

describe("decideSuggestion", () => {
  it("aprovar manda o grupo; rejeitar manda nulo", async () => {
    const a = fake();
    expect(await decideSuggestion(a.client, { suggestionId: ID, approve: true, category: " Ofícios " })).toEqual({ ok: true });
    expect(a.calls).toEqual([{ fn: "decide_skill_suggestion", args: { p_id: ID, p_approve: true, p_category: "Ofícios" } }]);
    const r = fake();
    await decideSuggestion(r.client, { suggestionId: ID, approve: false, category: "ignorado" });
    expect(r.calls).toEqual([{ fn: "decide_skill_suggestion", args: { p_id: ID, p_approve: false, p_category: null } }]);
  });

  it("aprovar sem grupo ou com id ruim: recusa sem chamar o banco", async () => {
    const { client, calls } = fake();
    expect(await decideSuggestion(client, { suggestionId: ID, approve: true, category: "" })).toEqual({ ok: false, error: "invalid" });
    expect(await decideSuggestion(client, { suggestionId: "x", approve: false })).toEqual({ ok: false, error: "invalid" });
    expect(calls).toEqual([]);
  });
});

describe("leituras", () => {
  it("o catálogo vem só com as ativas, por grupo e nome", async () => {
    const { client, filters } = fake({
      data: [
        { id: ID, name: "Teatro", category: "Artes", active: true },
        { id: ID2, name: "Antiga", category: "Artes", active: false },
      ],
    });
    expect(await listCatalog(client)).toEqual([{ id: ID, name: "Teatro", category: "Artes" }]);
    expect(filters).toContainEqual(["from", "skills", "id,name,category,active"]);
  });

  it("as habilidades da pessoa: só os ids, do perfil dela", async () => {
    const { client, filters } = fake({ data: [{ skill_id: ID }] });
    expect(await readMySkillIds(client, "u1")).toEqual([ID]);
    expect(filters).toContainEqual(["eq", "profile_id", "u1"]);
  });

  it("as sugestões da pessoa e a fila da coordenação não trazem o id de quem sugeriu na fila", async () => {
    const mine = fake({ data: [{ id: ID, name: "Teatro", status: "open", created_at: "2026-11-28T10:00:00+00:00" }] });
    expect(await listMySuggestions(mine.client, "u1")).toEqual([{ id: ID, name: "Teatro", status: "open", createdAt: "2026-11-28T10:00:00+00:00" }]);
    const queue = fake({ data: [{ id: ID, name: "Teatro", created_at: "2026-11-28T10:00:00+00:00" }] });
    expect(await listOpenSuggestions(queue.client)).toEqual([{ id: ID, name: "Teatro", createdAt: "2026-11-28T10:00:00+00:00" }]);
    expect(queue.filters).toContainEqual(["from", "skill_suggestions", "id,name,created_at"]);
    expect(queue.filters).toContainEqual(["eq", "status", "open"]);
  });

  it("erro de leitura sobe com o código, sem a mensagem", async () => {
    await expect(listCatalog(fake({ error: { code: "42501", message: "detalhe interno" } }).client)).rejects.toThrow("skills_read_failed:forbidden");
  });
});
