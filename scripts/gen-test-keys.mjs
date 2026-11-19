#!/usr/bin/env node
// Preenche as chaves de criptografia de TESTE no .env.local (#52, ADR 0003).
// Uso: node scripts/gen-test-keys.mjs [arquivo]   (padrão: .env.local)
// Só preenche chave vazia ou ausente; nunca troca uma que já existe (trocar a chave
// torna ilegível o que já foi cifrado no banco local). Nunca imprime os valores.
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const KEY_NAMES = ["FIELD_ENCRYPTION_KEY", "BLIND_INDEX_KEY"];

/** 32 bytes aleatórios em base64. */
export function generateKey() {
  return randomBytes(32).toString("base64");
}

/**
 * Devolve o conteúdo com as chaves vazias ou ausentes preenchidas.
 * @param {string} content conteúdo do arquivo .env
 * @param {() => string} [gen] gerador de chave (injetável nos testes)
 * @returns {{ content: string, filled: string[] }}
 */
export function fillTestKeys(content, gen = generateKey) {
  let out = content;
  const filled = [];
  for (const name of KEY_NAMES) {
    const line = new RegExp(`^${name}=(.*)$`, "m");
    const match = out.match(line);
    if (match && match[1].trim() !== "") continue;
    const entry = `${name}=${gen()}`;
    if (match) {
      out = out.replace(line, () => entry);
    } else {
      out = `${out}${out === "" || out.endsWith("\n") ? "" : "\n"}${entry}\n`;
    }
    filled.push(name);
  }
  return { content: out, filled };
}

/** Preenche as chaves no arquivo; devolve os nomes preenchidos (lança se o arquivo não existe). */
export function fillTestKeysInFile(file) {
  const result = fillTestKeys(readFileSync(file, "utf8"));
  if (result.filled.length > 0) {
    writeFileSync(file, result.content);
    chmodSync(file, 0o600); // só o dono lê; `mode` do writeFileSync não vale para arquivo existente
  }
  return result.filled;
}

function main() {
  const file = process.argv[2] ?? ".env.local";
  let filled;
  try {
    filled = fillTestKeysInFile(file);
  } catch {
    console.error(`gen-test-keys: não consegui ler ${file}. Rode \`npm run setup\` ou copie o .env.example.`);
    process.exit(1);
  }
  console.log(
    filled.length > 0
      ? `gen-test-keys: chaves de teste geradas em ${file}: ${filled.join(", ")}`
      : `gen-test-keys: ${file} já tem as chaves; nada mudou.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
