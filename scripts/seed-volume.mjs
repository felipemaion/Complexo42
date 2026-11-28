#!/usr/bin/env node
// `npm run db:seed-volume -- --count 2000|50000|500000 --sim-local` (issue #74): carrega perfis 100% fictícios no banco
// LOCAL do Supabase para medir desempenho (busca por habilidade, #23; `scripts/skill-search-benchmark.sql`).
// `npm run db:seed-volume -- --clean --sim-local` apaga só as contas deste seed (`vol-N@exemplo.invalid`).
//
// Nunca em servidor: recusa NODE_ENV=production, endereço que não seja 127.0.0.1/localhost, porta que não seja a do
// banco do Supabase local (a de `supabase/config.toml`), falta de `--sim-local` e banco que já tenha conta que não seja
// fictícia (a demo e os bancos com gente de verdade ficam de fora). Nome e WhatsApp saem cifrados pelo mesmo código do
// app (src/server/crypto, R13) com a chave de TESTE do `.env.local`. Pré-requisitos: `npm run setup`, o Supabase local
// de pé com as migrations (`npm run db:start`) e o cliente `psql` instalado. Rode via npm, que passa as opções do Node.
// Pode rodar de novo à vontade: as inserções ignoram o que já existe.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readConsentVersion } from "./seed-fake-profiles.mjs";
import {
  assertLocalTarget,
  batchRanges,
  buildBatchSql,
  buildVolumePerson,
  cleanSql,
  nonFictionalAccountsSql,
  parseVolumeArgs,
  readDbPort,
} from "./volume-seed.mjs";

function psql(db, { sql, input }) {
  const argv = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", db];
  if (sql !== undefined) argv.push("-c", sql);
  const run = spawnSync("psql", argv, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw new Error("não consegui rodar o `psql`: instale o cliente (ex.: brew install libpq) e tente de novo.");
  if (run.status !== 0) throw new Error(`psql falhou: ${(run.stderr || "").split("\n").find(Boolean) ?? "sem mensagem"}`);
  return run.stdout.split("\n").filter(Boolean);
}

const rows = (db, sql) => psql(db, { sql }).map((line) => line.split("\t"));

function readCatalog(db) {
  // Os fictícios ficam na Região Metropolitana de São Paulo (a base tem o Brasil inteiro).
  const municipalities = rows(db, "select code from public.municipalities where metro_region = 'rmsp' order by code").map(([code]) => ({ code: Number(code) }));
  const skillIds = rows(db, "select id from public.skills order by name").map(([id]) => id);
  const houseKeys = rows(db, "select key from public.houses where active order by key").map(([key]) => key);
  const teamUnitIds = rows(
    db,
    "select u.id from public.units as u join public.unit_types as t on t.id = u.type_id where t.key = 'team' and u.status = 'active' order by u.path",
  ).map(([id]) => id);
  if (municipalities.length === 0) throw new Error("não há municípios da RMSP no banco; rode `npm run db:reset`.");
  if (skillIds.length < 8) throw new Error("o catálogo de habilidades está vazio ou pequeno; rode `npm run db:reset`.");
  return { municipalities, skillIds, houseKeys, teamUnitIds };
}

async function main() {
  const args = parseVolumeArgs(process.argv.slice(2));
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assertLocalTarget({ dbUrl: args.db, localPort: readDbPort(config), simLocal: args.simLocal, nodeEnv: process.env.NODE_ENV });

  const strangers = Number(rows(args.db, nonFictionalAccountsSql())[0]?.[0]);
  if (strangers !== 0) {
    throw new Error(`recusado: o banco tem contas que não são fictícias (demo ou dados de verdade; contagem: ${strangers}). Use um banco só de teste.`);
  }

  if (args.clean) {
    psql(args.db, { sql: cleanSql() });
    console.log("seed-volume: contas vol-*@exemplo.invalid apagadas.");
    return;
  }

  // Importado aqui (e não no topo) para o erro de chave faltando sair com a mensagem do app.
  const { encryptField, whatsappBlindIndex } = await import("../src/server/crypto/index.ts");
  const crypto = { encrypt: encryptField, blindIndex: whatsappBlindIndex };
  const consentVersion = readConsentVersion(readFileSync(new URL("../config/consent.ts", import.meta.url), "utf8"));
  const catalog = readCatalog(args.db);

  const started = Date.now();
  for (const [from, to] of batchRanges(args.count)) {
    const people = Array.from({ length: to - from + 1 }, (_, k) => buildVolumePerson(from + k, catalog, args.seed));
    psql(args.db, { input: await buildBatchSql(people, { crypto, consentVersion }) });
    console.log(`seed-volume: ${to}/${args.count} (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  psql(args.db, { sql: "analyze public.profiles; analyze public.profile_skills; analyze public.profile_contacts;" });
  console.log(`seed-volume: ${args.count} perfis fictícios prontos (vol-1 ... vol-${args.count}@exemplo.invalid).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`seed-volume: ${error.message}`);
    process.exit(1);
  });
}
