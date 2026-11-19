#!/usr/bin/env node
// `npm run setup` (#52): prepara o ambiente local do zero. Pode rodar de novo à vontade.
// Só usa módulos nativos do Node: roda antes do `npm ci`.
//   1. .env.local a partir do .env.example (se ainda não existir)
//   2. chaves de criptografia de TESTE (scripts/gen-test-keys.mjs)
//   3. npm ci
//   4. Supabase local (Docker): na primeira subida aplica migrations + seed; se já estava
//      de pé, aplica só as migrations pendentes
//   5. SUPABASE_ANON_KEY do .env.local, lida de `supabase status` (chave anon pública do
//      Supabase local, não é segredo), para o login funcionar no `npm run dev`
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** Preenche SUPABASE_ANON_KEY só se estiver vazia ou ausente; nunca troca uma que já existe. */
export function fillAnonKey(content, anonKey) {
  const line = /^SUPABASE_ANON_KEY=(.*)$/m;
  const match = content.match(line);
  if (match && match[1].trim() !== "") return { content, filled: false };
  const entry = `SUPABASE_ANON_KEY=${anonKey}`;
  if (match) return { content: content.replace(line, () => entry), filled: true };
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return { content: `${content}${separator}${entry}\n`, filled: true };
}

/** Lê a chave anon do Supabase local de pé (JSON do `supabase status`); null se não achar. */
function readLocalAnonKey() {
  const r = spawnSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) return null;
  try {
    const key = JSON.parse(r.stdout).ANON_KEY;
    return typeof key === "string" && key !== "" ? key : null;
  } catch {
    return null;
  }
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

  const anonKey = readLocalAnonKey();
  if (anonKey === null) {
    console.warn("setup: não consegui ler a chave anon; copie de `npx supabase status` para SUPABASE_ANON_KEY no .env.local.");
  } else {
    const result = fillAnonKey(readFileSync(env.path, "utf8"), anonKey);
    if (result.filled) {
      writeFileSync(env.path, result.content);
      console.log("setup: SUPABASE_ANON_KEY preenchida com a chave anon do Supabase local.");
    }
  }

  console.log("\nsetup: pronto. Próximos passos: `npm run dev` e `npm run check`.");
  console.log("Para recriar o banco do zero (migrations + seed): `npm run db:reset`.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
