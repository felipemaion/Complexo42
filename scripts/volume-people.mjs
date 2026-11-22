// Seeds em volume (#74): pessoas 100% fictícias e determinísticas para medir desempenho com 2 mil,
// 50 mil ou 500 mil perfis. Puro (sem banco, sem relógio, sem Math.random): testado em
// tests/seed-volume.test.ts. Telefones no bloco fictício do projeto (#8), mas acima dos 50 do seed
// base: +5511900100000 em diante (nunca use em dado real).

export const VOLUME_SIZES = [2000, 50000, 500000];
export const MAX_VOLUME = 500000;
const PHONE_OFFSET = 100000;
const givenNames = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Hugo", "Isabela", "João"];

/** `--n 50000` → 50000. Sem `--n`, 2000 (o tamanho do piloto). */
export function parseVolumeCount(argv) {
  const at = argv.indexOf("--n");
  const raw = at >= 0 ? argv[at + 1] : "2000";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VOLUME) {
    throw new RangeError(`--n: um número inteiro de 1 a ${MAX_VOLUME} (tamanhos de referência: ${VOLUME_SIZES.join(", ")})`);
  }
  return n;
}

/** Pessoa fictícia número `index` (a partir de 0). */
export function volumePerson(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_VOLUME) throw new RangeError("index fora do volume");
  const number = String(index + 1).padStart(6, "0");
  return {
    email: `volume-${number}@example.com`,
    name: `${givenNames[index % givenNames.length]} Volume ${number}`,
    whatsapp: `+5511900${String(PHONE_OFFSET + index).padStart(6, "0")}`,
  };
}

/**
 * Nunca em produção. Sem SEED_VOLUME_DB_URL: só o container do Supabase local. Com endereço: só o
 * staging cujo host é EXATAMENTE o de SEED_VOLUME_STAGING_HOST, sem parâmetro que troque o servidor
 * (host=, hostaddr=, service=). Endereço em localhost é recusado: pode ser um túnel para produção.
 * O SQL ainda recusa banco com contas que não são de teste (scripts/seed-volume.sql).
 */
export function assertSafeTarget({ nodeEnv, dbUrl, stagingHost }) {
  if (nodeEnv === "production") throw new Error("recusado: NODE_ENV=production. Seed em volume só local ou no staging.");
  if (!dbUrl) return "local";
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    throw new Error("recusado: SEED_VOLUME_DB_URL não é um endereço válido.");
  }
  for (const param of ["host", "hostaddr", "service"]) {
    if (url.searchParams.has(param)) throw new Error(`recusado: o parâmetro ${param}= troca o servidor do endereço.`);
  }
  if (!stagingHost || url.hostname !== stagingHost) {
    throw new Error("recusado: o banco não é o staging informado em SEED_VOLUME_STAGING_HOST (pode ser produção).");
  }
  return "staging";
}
