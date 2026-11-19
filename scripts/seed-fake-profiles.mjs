#!/usr/bin/env node
// `npm run db:seed-profiles` (issue #8): cria ~50 perfis 100% fictícios no Supabase LOCAL, com
// nome e WhatsApp cifrados pelo mesmo código do app (src/server/crypto, R13), município,
// distrito e habilidades. Pode rodar de novo à vontade (atualiza os mesmos perfis).
//
// Só local, nunca produção: recusa NODE_ENV=production e qualquer endereço que não seja
// 127.0.0.1/localhost. A chave de acesso total vem de `supabase status` (nunca do .env nem do
// repositório) e fica só neste processo (R6, R7).
// Pré-requisitos: `npm run setup` (chaves de teste no .env.local) e o catálogo de habilidades
// carregado (`npm run db:reset`). Rode via npm, que passa as opções do Node.
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { districtsByMunicipality } from "../config/districts.ts";
import { buildFakePeople, fakePeopleCount } from "./fake-people.mjs";

const localHosts = new Set(["127.0.0.1", "localhost"]);

/** URL da API e chave de acesso total da stack local, lidas de `supabase status`. */
export function readLocalStack(statusOutput) {
  const values = Object.fromEntries(
    statusOutput
      .split("\n")
      .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const url = values.API_URL;
  const serviceKey = values.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("não achei API_URL/SERVICE_ROLE_KEY em `supabase status`; o Supabase local está de pé?");
  if (!localHosts.has(new URL(url).hostname)) throw new Error("recusado: o endereço da API não é local.");
  return { url, serviceKey };
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("recusado: é só para desenvolvimento local.");

  const status = spawnSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" });
  if (status.status !== 0) throw new Error("`supabase status` falhou; rode `npm run db:start`.");
  const { url, serviceKey } = readLocalStack(status.stdout);

  // Importado aqui (e não no topo) para o erro de chave faltando sair com a mensagem do app.
  const { encryptField, whatsappBlindIndex } = await import("../src/server/crypto/index.ts");

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const orFail = ({ data, error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };

  const municipalities = orFail(await db.from("municipalities").select("code").order("code"), "municípios");
  const skills = orFail(await db.from("skills").select("id").order("name"), "habilidades");
  if (skills.length === 0) throw new Error("o catálogo de habilidades está vazio; rode `npm run db:reset`.");

  const existing = new Map(
    orFail(await db.auth.admin.listUsers({ perPage: 1000 }), "contas").users.map((u) => [u.email, u.id]),
  );

  const people = buildFakePeople(fakePeopleCount, { municipalityCount: municipalities.length, skillCount: skills.length });
  for (const person of people) {
    let id = existing.get(person.email);
    if (!id) {
      const created = orFail(await db.auth.admin.createUser({ email: person.email, email_confirm: true }), "criar conta");
      id = created.user.id;
    }
    const municipality = municipalities[person.municipalityIndex].code;
    const districts = districtsByMunicipality[municipality];

    orFail(
      await db.from("profiles").upsert({
        id,
        display_name_enc: await encryptField(person.name, { table: "profiles", column: "display_name_enc", rowId: id }),
        municipality_code: municipality,
        district: districts ? districts[person.index % districts.length] : null,
        status: "active",
        access_status: "active",
      }),
      "perfil",
    );
    orFail(
      await db.from("profile_contacts").upsert({
        profile_id: id,
        whatsapp_enc: await encryptField(person.whatsapp, { table: "profile_contacts", column: "whatsapp_enc", rowId: id }),
        whatsapp_hmac: await whatsappBlindIndex(person.whatsapp),
      }),
      "contato",
    );
    orFail(await db.from("profile_skills").delete().eq("profile_id", id), "limpar habilidades");
    orFail(
      await db.from("profile_skills").insert(person.skillIndexes.map((i) => ({ profile_id: id, skill_id: skills[i].id }))),
      "habilidades",
    );
  }
  console.log(`seed-profiles: ${people.length} perfis fictícios prontos (${people[0].email} ... ${people.at(-1).email}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`seed-profiles: ${error.message}`);
    process.exit(1);
  });
}
