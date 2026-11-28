// Seeds em volume (#74): a parte PURA do gerador de 2 mil, 50 mil e 500 mil perfis fictícios para medir desempenho
// (busca por habilidade, #23). Sem `Math.random`, sem relógio e sem rede: a mesma `--seed` gera as mesmas pessoas, e a
// trava de "só local" é função testada. Quem fala com o banco é `seed-volume.mjs`.
//
// Tudo é fictício: nome com sobrenome de teste, e-mail em `@exemplo.invalid` (domínio reservado, RFC 2606) e telefone
// `+55119` + 8 dígitos a partir de 10.000.000 (não colide com os +55119000000xx do seed pequeno, #8; é fictício só por
// convenção, nunca use em dado real).

export const volumeSizes = [2000, 50000, 500000];
export const volumeEmailDomain = "exemplo.invalid";
export const defaultVolumeDb = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const maxCount = 500000;
const capitalCode = 3550308;
const givenNames = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Hugo", "Isabela", "João"];
const fictionalSurnames = ["Exemplo", "Teste", "Modelo", "Demo", "Fictício"];
// Quantas habilidades cada pessoa tem, de 1 a 8 (em %): a maioria entre 2 e 4.
const skillCountWeights = [8, 18, 24, 22, 14, 8, 4, 2];
const localHosts = new Set(["127.0.0.1", "localhost"]);

/** Lê as opções da linha de comando (`--count N`, `--seed N`, `--db URL`, `--clean`, `--sim-local`). */
export function parseVolumeArgs(argv) {
  const args = { count: 0, seed: 1, clean: false, simLocal: false, db: defaultVolumeDb };
  let countGiven = false;
  const list = [...argv];
  const take = (name, inline) => {
    if (inline !== undefined) return inline;
    const next = list.shift();
    if (next === undefined || next.startsWith("--")) throw new RangeError(`${name}: faltou o valor`);
    return next;
  };
  while (list.length > 0) {
    const raw = list.shift();
    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    if (flag === "--count") {
      const value = take("--count", inline);
      if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > maxCount) {
        throw new RangeError(`--count: um inteiro de 1 a ${maxCount} (use 2000, 50000 ou 500000)`);
      }
      args.count = Number(value);
      countGiven = true;
    } else if (flag === "--seed") {
      const value = take("--seed", inline);
      if (!/^[0-9]{1,9}$/.test(value)) throw new RangeError("--seed: um inteiro de 0 a 999999999");
      args.seed = Number(value);
    } else if (flag === "--db") {
      args.db = take("--db", inline);
    } else if (flag === "--clean") {
      args.clean = true;
    } else if (flag === "--sim-local") {
      args.simLocal = true;
    } else {
      throw new RangeError(`opção desconhecida: ${flag}`);
    }
  }
  if (!countGiven && !args.clean) throw new RangeError("--count: informe a quantidade (2000, 50000 ou 500000) ou use --clean");
  return args;
}

/** A porta do banco do Supabase local, lida da seção `[db]` do `supabase/config.toml`. */
export function readDbPort(configToml) {
  const section = /^\[db\]\s*$/m.exec(configToml);
  const rest = section ? configToml.slice(section.index + section[0].length) : "";
  const next = rest.search(/^\[/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const port = /^\s*port\s*=\s*(\d+)/m.exec(body)?.[1];
  if (!port) throw new Error("não achei a porta do banco em supabase/config.toml ([db] port)");
  return Number(port);
}

/**
 * A trava de "nunca no servidor": produção recusada, só 127.0.0.1/localhost, só a porta do banco do Supabase local
 * (a do `config.toml`), e o `--sim-local` explícito. Falha fechado em qualquer dúvida.
 */
export function assertLocalTarget({ dbUrl, localPort, simLocal, nodeEnv }) {
  if (nodeEnv === "production") throw new Error("recusado: produção (NODE_ENV=production); este seed é só para o banco local.");
  if (!simLocal) throw new Error("recusado: confirme que é o banco local com --sim-local.");
  const url = new URL(dbUrl);
  if (!localHosts.has(url.hostname)) throw new Error("recusado: o endereço do banco não é local (só 127.0.0.1 ou localhost).");
  if (url.port !== String(localPort)) throw new Error(`recusado: a porta não é a do Supabase local (${localPort}).`);
}

/** Só os e-mails fictícios deste seed, do seed pequeno (#8) e do benchmark entram num banco que receberá o volume. */
export function isFictionalEmail(email) {
  return /^[a-z0-9-]+@exemplo\.invalid$/.test(email) || /^perfil-ficticio-[0-9]+@example\.com$/.test(email);
}

/** Conta as contas que NÃO são fictícias: se for diferente de zero, o seed recusa rodar (banco com gente de verdade). */
export function nonFictionalAccountsSql() {
  return (
    "select count(*) from auth.users where email is not null " +
    "and email !~ '^[a-z0-9-]+@exemplo\\.invalid$' and email !~ '^perfil-ficticio-[0-9]+@example\\.com$'"
  );
}

const hex12 = (index) => index.toString(16).padStart(12, "0");
export const volumeId = (index) => `5eed0000-0000-4000-8000-${hex12(index)}`;
export const volumeEmail = (index) => `vol-${index}@${volumeEmailDomain}`;
export const volumePhone = (index) => `+55119${10_000_000 + index}`;
export const volumeName = (index) =>
  `${givenNames[index % givenNames.length]} ${fictionalSurnames[Math.floor(index / givenNames.length) % fictionalSurnames.length]} ${index}`;

/** Gerador pseudoaleatório pequeno e determinístico (mulberry32), um por pessoa. */
function rngFor(index, seed) {
  let state = (Math.imul(index, 0x9e3779b1) ^ Math.imul(seed + 1, 0x85ebca6b)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sorteia um índice pela tabela de pesos acumulados. */
function pick(cumulativeWeights, roll) {
  const target = roll * cumulativeWeights.at(-1);
  let low = 0;
  let high = cumulativeWeights.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulativeWeights[mid] > target) high = mid;
    else low = mid + 1;
  }
  return low;
}

const cumulative = (weights) => weights.reduce((acc, weight) => (acc.push((acc.at(-1) ?? 0) + weight), acc), []);

// Pesos por catálogo (calculados uma vez): a capital com 35%, o resto em Zipf; habilidades com popularidade em Zipf suave.
const tables = new WeakMap();
function tablesFor(catalog) {
  let found = tables.get(catalog);
  if (found) return found;
  const codes = catalog.municipalities.map((m) => m.code);
  const hasCapital = codes.includes(capitalCode);
  const others = codes.filter((code) => code !== capitalCode);
  const zipf = others.map((_, rank) => 1 / (rank + 1));
  const zipfTotal = zipf.reduce((a, b) => a + b, 0) || 1;
  const municipalityWeights = hasCapital
    ? [0.35, ...zipf.map((w) => (0.65 * w) / zipfTotal)]
    : codes.map((_, rank) => 1 / (rank + 1));
  found = {
    municipalityCodes: hasCapital ? [capitalCode, ...others] : codes,
    municipalities: cumulative(municipalityWeights),
    skillCounts: cumulative(skillCountWeights),
    skills: cumulative(catalog.skillIds.map((_, rank) => 1 / (rank + 1) ** 0.7)),
  };
  tables.set(catalog, found);
  return found;
}

/**
 * Uma pessoa fictícia, só pelo número dela e pela semente. Município com pesos (capital à frente), de 1 a 8 habilidades
 * distintas (algumas mais populares), uma casa e uma equipe do catálogo (nulas se o catálogo não tiver).
 */
export function buildVolumePerson(index, catalog, seed = 1) {
  if (catalog.municipalities.length < 1) throw new RangeError("catálogo sem município");
  if (catalog.skillIds.length < skillCountWeights.length) throw new RangeError("catálogo com menos de 8 habilidades");
  const t = tablesFor(catalog);
  const next = rngFor(index, seed);
  const municipalityCode = t.municipalityCodes[pick(t.municipalities, next())];
  const wanted = pick(t.skillCounts, next()) + 1;
  const chosen = new Set();
  while (chosen.size < wanted) chosen.add(pick(t.skills, next()));
  const houseKey = catalog.houseKeys.length > 0 ? catalog.houseKeys[Math.floor(next() * catalog.houseKeys.length)] : null;
  const teamUnitId = catalog.teamUnitIds.length > 0 ? catalog.teamUnitIds[Math.floor(next() * catalog.teamUnitIds.length)] : null;
  return {
    index,
    id: volumeId(index),
    email: volumeEmail(index),
    name: volumeName(index),
    whatsapp: volumePhone(index),
    municipalityCode,
    skillIds: [...chosen].map((i) => catalog.skillIds[i]),
    houseKey,
    teamUnitId,
  };
}

/** Divide as pessoas 1..N em lotes [de, até] (inclusive). */
export function batchRanges(count, size = 5000) {
  const ranges = [];
  for (let from = 1; from <= count; from += size) ranges.push([from, Math.min(count, from + size - 1)]);
  return ranges;
}

/** Um campo do formato texto do `COPY`: tab, quebra de linha e barra escapados; nulo vira `\N`. */
export function copyField(value) {
  if (value === null || value === undefined) return "\\N";
  return String(value).replaceAll("\\", "\\\\").replaceAll("\t", "\\t").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}

function copyBlock(table, columns, rows) {
  const body = rows.map((row) => row.map(copyField).join("\t")).join("\n");
  return `create temp table ${table} (${columns}) on commit drop;\ncopy ${table} from stdin;\n${body}${rows.length > 0 ? "\n" : ""}\\.\n`;
}

/**
 * O SQL de um lote: uma transação com `COPY` para tabelas temporárias e `insert ... select ... on conflict do nothing`
 * nas tabelas reais (rodar de novo não duplica). Nome e WhatsApp saem cifrados pelo mesmo código do app, com o contexto
 * (AAD) da própria linha; o texto em claro nunca entra no SQL.
 */
export async function buildBatchSql(people, { crypto, consentVersion }) {
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(consentVersion)) throw new RangeError("consentVersion inválida");
  const peopleRows = [];
  const contactRows = [];
  for (const person of people) {
    const nameEnc = await crypto.encrypt(person.name, { table: "profiles", column: "display_name_enc", rowId: person.id });
    const whatsappEnc = await crypto.encrypt(person.whatsapp, { table: "profile_contacts", column: "whatsapp_enc", rowId: person.id });
    peopleRows.push([person.id, person.email, nameEnc, person.municipalityCode]);
    contactRows.push([person.id, whatsappEnc, await crypto.blindIndex(person.whatsapp)]);
  }
  const skillRows = people.flatMap((p) => p.skillIds.map((skillId) => [p.id, skillId]));
  const houseRows = people.filter((p) => p.houseKey !== null).map((p) => [p.id, p.houseKey]);
  const teamRows = people.filter((p) => p.teamUnitId !== null).map((p) => [p.id, p.teamUnitId]);
  const parts = ["begin;\n"];
  parts.push(copyBlock("v_people", "id uuid, email text, name_enc text, municipality int", peopleRows));
  parts.push(copyBlock("v_contacts", "id uuid, whatsapp_enc text, whatsapp_hmac text", contactRows));
  parts.push(copyBlock("v_skills", "profile_id uuid, skill_id uuid", skillRows));
  if (houseRows.length > 0) parts.push(copyBlock("v_houses", "profile_id uuid, house_key text", houseRows));
  if (teamRows.length > 0) parts.push(copyBlock("v_teams", "profile_id uuid, unit_id uuid", teamRows));
  parts.push(
    "insert into auth.users (id, email) select id, email from v_people on conflict do nothing;\n",
    `insert into public.profiles (id, display_name_enc, municipality_code, consent_version, access_status, status)\n  select id, name_enc, municipality, '${consentVersion}', 'active', 'active' from v_people on conflict do nothing;\n`,
    `insert into public.consent_acceptances (user_id, version) select id, '${consentVersion}' from v_people on conflict do nothing;\n`,
    "insert into public.profile_contacts (profile_id, whatsapp_enc, whatsapp_hmac) select id, whatsapp_enc, whatsapp_hmac from v_contacts on conflict do nothing;\n",
    "insert into public.profile_skills (profile_id, skill_id) select profile_id, skill_id from v_skills on conflict do nothing;\n",
  );
  if (houseRows.length > 0) {
    parts.push(
      "insert into public.house_members (profile_id, house_key, join_method, accepted_at) select profile_id, house_key, 'self', now() from v_houses on conflict do nothing;\n",
    );
  }
  if (teamRows.length > 0) {
    // A ativação pode já ter aberto um vínculo (a unidade do estado): o conflito só pula quem já tem vínculo aberto.
    parts.push("insert into public.unit_members (profile_id, unit_id) select profile_id, unit_id from v_teams on conflict do nothing;\n");
  }
  parts.push("commit;\n");
  return parts.join("");
}

/** Apaga só as contas deste seed (o `on delete cascade` leva perfis, habilidades, contatos e vínculos). */
export function cleanSql() {
  return `delete from auth.users where email like 'vol-%@${volumeEmailDomain}';\n`;
}
