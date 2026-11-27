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
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
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

/**
 * A versão do termo de config/consent.ts (a mesma que o app exige no portão, #11). Lida do texto
 * do arquivo porque o Node deste script não resolve os atalhos `@/` que a config usa.
 */
export function readConsentVersion(configSource) {
  const version = /\bversion:\s*"([A-Za-z0-9._-]{1,32})"/.exec(configSource)?.[1];
  if (!version) throw new Error("não achei a versão do termo em config/consent.ts");
  return version;
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

  // Os fictícios ficam na Região Metropolitana de São Paulo (a base agora tem o Brasil inteiro).
  const municipalities = orFail(
    await db.from("municipalities").select("code").eq("metro_region", "rmsp").order("code"),
    "municípios",
  );
  const districtsByMunicipality = new Map();
  for (const district of orFail(
    await db.from("districts").select("code, municipality_code").in("municipality_code", municipalities.map((m) => m.code)).order("code"),
    "distritos",
  )) {
    districtsByMunicipality.set(district.municipality_code, [...(districtsByMunicipality.get(district.municipality_code) ?? []), district.code]);
  }
  const skills = orFail(await db.from("skills").select("id").order("name"), "habilidades");
  if (skills.length === 0) throw new Error("o catálogo de habilidades está vazio; rode `npm run db:reset`.");

  const existing = new Map(
    orFail(await db.auth.admin.listUsers({ perPage: 1000 }), "contas").users.map((u) => [u.email, u.id]),
  );

  const consentVersion = readConsentVersion(readFileSync(new URL("../config/consent.ts", import.meta.url), "utf8"));
  const people = buildFakePeople(fakePeopleCount, { municipalityCount: municipalities.length, skillCount: skills.length });
  for (const person of people) {
    let id = existing.get(person.email);
    if (!id) {
      const created = orFail(await db.auth.admin.createUser({ email: person.email, email_confirm: true }), "criar conta");
      id = created.user.id;
    }
    const municipality = municipalities[person.municipalityIndex].code;
    // Município com um distrito só (a sede) não tem escolha: distrito nulo (#175).
    const districts = districtsByMunicipality.get(municipality) ?? [];

    orFail(
      await db.from("profiles").upsert({
        id,
        display_name_enc: await encryptField(person.name, { table: "profiles", column: "display_name_enc", rowId: id }),
        municipality_code: municipality,
        district_code: districts.length > 1 ? districts[person.index % districts.length] : null,
        status: "active",
        access_status: "active",
        consent_version: consentVersion,
      }),
      "perfil",
    );
    // Aceite fictício da versão vigente do termo (#11): sem a linha, o portão levaria a pessoa a /termo.
    orFail(
      await db.from("consent_acceptances").upsert({ user_id: id, version: consentVersion }, { onConflict: "user_id,version" }),
      "aceite do termo",
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
