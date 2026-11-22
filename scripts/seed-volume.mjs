#!/usr/bin/env node
// `npm run db:seed-volume -- --n 50000` (#74): base fictícia grande para medir desempenho.
// Nome e WhatsApp cifrados pelo MESMO código do app (src/server/crypto, ADR 0003) com as chaves de
// teste do .env.local; tudo entra por COPY numa tabela temporária e o SQL de scripts/seed-volume.sql
// espalha pelas tabelas (contas, perfis, contatos, equipes, habilidades, missões, entregas, pontos).
// Nunca em produção (scripts/volume-people.mjs, assertSafeTarget). Sem SEED_VOLUME_DB_URL, usa o
// container do Supabase local; no staging, SEED_VOLUME_DB_URL=<url do staging> e `psql` instalado.
// Roda numa base limpa (`npm run db:reset`): se já houver base em volume, o SQL recusa.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertSafeTarget, parseVolumeCount, volumePerson } from "./volume-people.mjs";

function localContainer() {
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8"))?.[1];
  if (!projectId) throw new Error("não achei project_id em supabase/config.toml");
  return `supabase_db_${projectId}`;
}

async function main() {
  const count = parseVolumeCount(process.argv.slice(2));
  const dbUrl = process.env.SEED_VOLUME_DB_URL;
  const target = assertSafeTarget({ nodeEnv: process.env.NODE_ENV, dbUrl, stagingHost: process.env.SEED_VOLUME_STAGING_HOST });
  // Importado aqui para o erro de chave faltando sair com a mensagem do app.
  const { encryptField, whatsappBlindIndex } = await import("../src/server/crypto/index.ts");

  const [command, args] = dbUrl
    ? ["psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q"]]
    : ["docker", ["exec", "-i", localContainer(), "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"]];
  const psql = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });
  const finished = new Promise((resolve) => psql.on("close", resolve));
  const write = (text) => new Promise((resolve) => (psql.stdin.write(text) ? resolve() : psql.stdin.once("drain", resolve)));

  const started = Date.now();
  await write("set client_min_messages = warning;\n");
  await write("create temp table seed_people (i integer, id uuid, email text, name_enc text, wa_enc text, wa_hmac text);\n");
  await write("copy seed_people from stdin with (format csv);\n");
  for (let i = 0; i < count; i++) {
    const person = volumePerson(i);
    const id = randomUUID();
    const nameEnc = await encryptField(person.name, { table: "profiles", column: "display_name_enc", rowId: id });
    const waEnc = await encryptField(person.whatsapp, { table: "profile_contacts", column: "whatsapp_enc", rowId: id });
    const waHmac = await whatsappBlindIndex(person.whatsapp);
    await write(`${i},${id},${person.email},${nameEnc},${waEnc},${waHmac}\n`);
  }
  await write("\\.\n");
  await write(readFileSync(new URL("./seed-volume.sql", import.meta.url), "utf8"));
  psql.stdin.end();
  const code = await finished;
  if (code !== 0) throw new Error(`o psql terminou com erro (${code})`);
  console.log(`seed-volume: ${count} perfis fictícios (${target}) em ${Math.round((Date.now() - started) / 1000)} s.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`seed-volume: ${error.message}`);
    process.exit(1);
  });
}
