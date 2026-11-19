#!/usr/bin/env node
// `npm run setup` (#52): prepara o ambiente local do zero. Pode rodar de novo à vontade.
// Só usa módulos nativos do Node: roda antes do `npm ci`.
//   1. .env.local a partir do .env.example (se ainda não existir)
//   2. chaves de criptografia de TESTE (scripts/gen-test-keys.mjs)
//   3. npm ci
//   4. Supabase local (Docker): na primeira subida aplica migrations + seed; se já estava
//      de pé, aplica só as migrations pendentes
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fillTestKeysInFile } from "./gen-test-keys.mjs";

/** Cria .env.local a partir do .env.example sem nunca sobrescrever um existente. */
export function ensureEnvFile(root) {
  const path = join(root, ".env.local");
  if (existsSync(path)) return { created: false, path };
  copyFileSync(join(root, ".env.example"), path);
  return { created: true, path };
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\nsetup: falhou em \`${cmd} ${args.join(" ")}\`.`);
    process.exit(r.status ?? 1);
  }
}

function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("setup: é só para desenvolvimento local; NODE_ENV=production recusado.");
    process.exit(1);
  }

  const env = ensureEnvFile(process.cwd());
  console.log(env.created ? "setup: .env.local criado a partir do .env.example." : "setup: .env.local já existe; mantido.");
  const filled = fillTestKeysInFile(env.path);
  if (filled.length > 0) console.log(`setup: chaves de teste geradas: ${filled.join(", ")}.`);

  run("npm", ["ci"]);

  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "\nsetup: o Docker não está rodando. Abra o Docker Desktop/OrbStack (ou o serviço docker) e rode `npm run setup` de novo.",
    );
    process.exit(1);
  }

  // Já de pé, o `supabase start` não reaplica nada: `migration up` cobre as migrations novas.
  run("npx", ["supabase", "start"]);
  run("npx", ["supabase", "migration", "up"]);

  console.log("\nsetup: pronto. Próximos passos: `npm run dev` e `npm run check`.");
  console.log("Para recriar o banco do zero (migrations + seed): `npm run db:reset`.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
