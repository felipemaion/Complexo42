import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { acceptTermIfAsked } from "./accept-term";

// Colunas cifradas (#155, R13, ADR 0003): uma pessoa fictícia salva nome, WhatsApp e rede social
// pelo fluxo real, e o teste varre TODAS as colunas de texto do esquema public direto no Postgres:
// nenhuma guarda esses valores legíveis. Repete depois de "Baixar meus dados" (o arquivo traz os
// valores abertos, mas nada legível fica no banco) e depois de "Excluir minha conta" (nada sobra).
// Para rodar (stack local de pé):
//   E2E_LIVE_SUPABASE_URL=<API_URL> E2E_LIVE_ANON_KEY=<ANON_KEY> E2E_LIVE_SERVICE_KEY=<SERVICE_ROLE_KEY> \
//   E2E_LIVE_DB_CONTAINER=<container do banco, ex.: supabase_db_complexo42> \
//   npm run test:e2e -- e2e/encrypted-columns-live.spec.ts
// A chave de serviço do stack LOCAL fica só neste processo (link de login e liberação); o app
// nunca a recebe (R6).
const API = process.env.E2E_LIVE_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_LIVE_SERVICE_KEY ?? process.env.E2E_LIVE_SERVICE_ROLE_KEY;
const DB_CONTAINER = process.env.E2E_LIVE_DB_CONTAINER;
const LIVE = Boolean(API && SERVICE_KEY && DB_CONTAINER);

test.describe("colunas cifradas com o Supabase local", () => {
  test.skip(!LIVE, "precisa do Supabase local, da chave de serviço e do container do banco (ver o topo do arquivo)");
  test.describe.configure({ mode: "serial" });

  // Marcas aleatórias só de letras e números: aparecem no texto aberto e em nenhum outro lugar.
  const token = () => randomBytes(6).toString("hex");
  const nameMark = `cifra${token()}`;
  const socialMark = `rede${token()}`;
  const phoneTail = String(10_000_000 + (randomBytes(4).readUInt32BE(0) % 89_999_999));
  const person = {
    email: `cifra.${Date.now()}@exemplo.org`,
    name: `Pessoa ${nameMark}`,
    phone: `11 9${phoneTail}`,
    social: `instagram.com/${socialMark}`,
  };
  const needles = [nameMark, phoneTail, socialMark];
  let id = "";
  let page: Page;

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });
  const sql = (query: string) =>
    execFileSync("docker", ["exec", "-i", DB_CONTAINER!, "psql", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", query], {
      encoding: "utf8",
    }).trim();

  /** Colunas de texto (text, varchar, json, jsonb, arrays) do esquema public que contêm o trecho. */
  function columnsContaining(needle: string): string[] {
    expect(needle).toMatch(/^[a-z0-9]+$/);
    const found = sql(`
      select c.table_name || '.' || c.column_name
      from information_schema.columns as c
      join information_schema.tables as t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.data_type in ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
        and (xpath('/row/n/text()', query_to_xml(
          format('select count(*) as n from public.%I where %I::text ilike %L', c.table_name, c.column_name, '%${needle}%'),
          false, true, '')))[1]::text::int > 0`);
    return found === "" ? [] : found.split("\n");
  }
  const expectNothingReadable = () => {
    for (const needle of needles) expect(columnsContaining(needle), `trecho legível: ${needle}`).toEqual([]);
  };

  test("o perfil salvo pela tela fica cifrado em todas as colunas", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const link = await (await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email: person.email }) })).json();
    id = link.id;
    page = await (await browser.newContext()).newPage();
    await page.goto(`/auth/confirmar?token_hash=${link.hashed_token}&type=${link.verification_type}`);
    await page.getByRole("button", { name: "Entrar" }).click();
    await acceptTermIfAsked(page);
    await expect(page).toHaveURL(`${baseURL}/perfil`);
    await page.getByLabel("Seu nome").fill(person.name);
    await page.getByLabel("Seu WhatsApp, com DDD").fill(person.phone);
    // Formulário novo da main (#cidades/distritos): estado → cidade → distrito (São Paulo tem vários).
    await page.getByLabel("Seu estado").selectOption({ label: "São Paulo" });
    await page.getByLabel("Sua cidade", { exact: true }).selectOption({ label: "São Paulo" });
    await page.getByLabel("Seu distrito").selectOption({ label: "Sé" });
    await page.getByRole("button", { name: "Pôr mais um link" }).click();
    await page.getByLabel("Link 1", { exact: true }).fill(person.social);
    await page.getByRole("button", { name: "Salvar meus dados" }).click();
    await expect(page).toHaveURL(`${baseURL}/espera`);
    const released = await admin(`/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ access_status: "active", status: "active" }) });
    expect(released.ok).toBe(true);

    // As colunas existem e estão no formato cifrado (v<versão>.<nonce>.<dado>).
    expect(sql(`select display_name_enc ~ '^v[0-9]+[.]' from public.profiles where id = '${id}'`)).toBe("t");
    expect(sql(`select whatsapp_enc ~ '^v[0-9]+[.]' and social_links_enc ~ '^v[0-9]+[.]' from public.profile_contacts where profile_id = '${id}'`)).toBe("t");
    expectNothingReadable();
  });

  test("baixar os dados abre os valores no arquivo, mas nada legível fica no banco", async ({ baseURL }) => {
    const res = await page.request.post("/meus-dados", { headers: { Origin: baseURL! } });
    expect(res.ok()).toBe(true);
    const file = JSON.parse(await res.text());
    expect(file.perfil.nome).toBe(person.name);
    expect(String(file.contato.whatsapp).replace(/\D/g, "")).toContain(phoneTail);
    expect(JSON.stringify(file.contato)).toContain(socialMark);
    expectNothingReadable();
  });

  test("depois de excluir a conta, nada da pessoa sobra no banco", async ({ baseURL }) => {
    await page.goto("/excluir-conta");
    await page.getByLabel(/escreva EXCLUIR/).fill("EXCLUIR");
    await page.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
    await expect(page).toHaveURL(`${baseURL}/conta-excluida`);
    expect(sql(`select count(*) from public.profiles where id = '${id}'`)).toBe("0");
    expect(sql(`select count(*) from public.profile_contacts where profile_id = '${id}'`)).toBe("0");
    expectNothingReadable();
  });
});
