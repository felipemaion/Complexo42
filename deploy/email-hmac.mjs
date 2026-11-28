// HMAC do e-mail (índice cego da lista de autorizados, ADR 0008 §1), para o bootstrap da primeira
// coordenação (#295). Roda DENTRO do container do app (`docker exec -i <app> node --input-type=module -e "$(cat email-hmac.mjs)"`),
// onde está a BLIND_INDEX_KEY: a chave nunca sai do app e o banco nunca a vê.
//
// Mesma conta de `emailBlindIndexWith` (src/server/crypto/field.ts): HMAC-SHA256(chave, "em:" + e-mail
// em minúsculas e sem espaços nas pontas), em hex. `tests/email-hmac.test.ts` garante que as duas
// saem iguais.
//
// Entrada: o e-mail por stdin (nunca por argumento: argumento aparece em `ps` e no histórico).
// Saída: só o HMAC no stdout. Em erro, sai != 0 sem nada no stdout e sem ecoar e-mail nem chave.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

function falha(motivo) {
  process.stderr.write(`email-hmac: ${motivo}\n`);
  process.exit(1);
}

const bruto = readFileSync(0, "utf8").split("\n")[0] ?? "";
const email = bruto.trim().toLowerCase();
if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) falha("e-mail inválido");

const valor = process.env.BLIND_INDEX_KEY ?? "";
// Mesmo formato de `decodeKey` (src/server/env.ts): 32 bytes em base64 canônico.
if (!/^[A-Za-z0-9+/]{43}=$/.test(valor)) falha("BLIND_INDEX_KEY ausente ou inválida");
const chave = Buffer.from(valor, "base64");
if (chave.length !== 32 || chave.toString("base64") !== valor) falha("BLIND_INDEX_KEY ausente ou inválida");

process.stdout.write(`${createHmac("sha256", chave).update(`em:${email}`).digest("hex")}\n`);
