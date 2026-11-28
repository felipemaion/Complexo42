// Seeds em volume (#74): o gerador é puro e determinístico, a cifra passa pelo mesmo caminho do app (contexto/AAD por
// linha) e a trava recusa tudo que não for o banco local, com `--sim-local` explícito. O banco em si é conferido à mão
// (sem Docker no CI para 50 mil linhas): aqui se prova a forma do que seria enviado.
import { describe, expect, it } from "vitest";
import {
  assertLocalTarget,
  batchRanges,
  buildBatchSql,
  buildVolumePerson,
  cleanSql,
  copyField,
  isFictionalEmail,
  parseVolumeArgs,
  readDbPort,
  volumeEmail,
  volumeId,
  volumeName,
  volumePhone,
  volumeSizes,
  type VolumeCatalog,
} from "../scripts/volume-seed.mjs";

const SKILLS = Array.from({ length: 47 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const catalog: VolumeCatalog = {
  municipalities: [3550308, 3548708, 3547809, 3518800, 3548500, 3513801, 3552205, 3529401].map((code) => ({ code })),
  skillIds: SKILLS,
  houseKeys: ["casa-a", "casa-b", "casa-c"],
  teamUnitIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
};
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("parseVolumeArgs", () => {
  it("os três tamanhos do piloto, da expansão e além da margem", () => {
    expect(volumeSizes).toEqual([2000, 50000, 500000]);
  });
  it("lê --count, --seed, --db e --sim-local", () => {
    expect(parseVolumeArgs(["--count", "2000", "--seed", "7", "--sim-local"])).toEqual({
      count: 2000,
      seed: 7,
      clean: false,
      simLocal: true,
      db: LOCAL,
    });
    expect(parseVolumeArgs(["--clean", "--sim-local"]).clean).toBe(true);
    expect(parseVolumeArgs(["--count=50", "--db=postgresql://u:p@localhost:54322/x"]).db).toBe("postgresql://u:p@localhost:54322/x");
  });
  it("recusa quantidade inválida ou acima de 500 mil, e opção desconhecida", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "500001"]) expect(() => parseVolumeArgs(["--count", bad])).toThrow(/count/);
    expect(() => parseVolumeArgs(["--count"])).toThrow(/count/);
    expect(() => parseVolumeArgs(["--tudo"])).toThrow(/desconhecida/);
  });
  it("sem --count nem --clean, pede a quantidade", () => {
    expect(() => parseVolumeArgs([])).toThrow(/count/);
  });
});

describe("assertLocalTarget (nunca em servidor)", () => {
  const ok = { dbUrl: LOCAL, localPort: 54322, simLocal: true };
  it("aceita o banco local com --sim-local", () => {
    expect(() => assertLocalTarget(ok)).not.toThrow();
    expect(() => assertLocalTarget({ ...ok, dbUrl: "postgresql://postgres:postgres@localhost:54322/postgres" })).not.toThrow();
  });
  it("recusa sem --sim-local", () => {
    expect(() => assertLocalTarget({ ...ok, simLocal: false })).toThrow(/--sim-local/);
  });
  it("recusa produção", () => {
    expect(() => assertLocalTarget({ ...ok, nodeEnv: "production" })).toThrow(/produção/);
  });
  it.each([
    "postgresql://u:p@db.projeto.exemplo.org:5432/postgres",
    "postgresql://u:p@127.0.0.1.evil.com:54322/postgres",
    "postgresql://u:p@localhost.evil.com:54322/postgres",
    "postgresql://u:p@10.0.0.5:54322/postgres",
    "postgresql://u:p@[::1]:54322/postgres",
  ])("recusa host que não é local: %s", (dbUrl) => {
    expect(() => assertLocalTarget({ ...ok, dbUrl })).toThrow(/não é local/);
  });
  it.each(["postgresql://u:p@127.0.0.1:5432/postgres", "postgresql://u:p@127.0.0.1/postgres", "postgresql://u:p@127.0.0.1:54321/postgres"])(
    "recusa porta que não é a do Supabase local: %s",
    (dbUrl) => {
      expect(() => assertLocalTarget({ ...ok, dbUrl })).toThrow(/porta/);
    },
  );
  it("recusa URL ilegível", () => {
    expect(() => assertLocalTarget({ ...ok, dbUrl: "isto não é url" })).toThrow();
  });
});

describe("readDbPort", () => {
  it("lê a porta do [db] do config.toml, não a da API", () => {
    const toml = `[api]\nport = 54321\n\n[db]\nport = 54322\nshadow_port = 54320\n`;
    expect(readDbPort(toml)).toBe(54322);
  });
  it("falha fechado sem a porta", () => {
    expect(() => readDbPort("[api]\nport = 1\n")).toThrow(/porta/);
  });
});

describe("dados 100% fictícios", () => {
  it("só e-mails do domínio reservado deste seed (e o do seed de 50) contam como fictícios", () => {
    expect(isFictionalEmail("vol-1@exemplo.invalid")).toBe(true);
    expect(isFictionalEmail("perfil-ficticio-01@example.com")).toBe(true);
    expect(isFictionalEmail("alguem@gmail.com")).toBe(false);
    expect(isFictionalEmail("vol-1@exemplo.invalid.evil.com")).toBe(false);
  });
  it("id, e-mail, telefone e nome são únicos, determinísticos e no formato reservado", () => {
    const n = 5000;
    const ids = new Set<string>();
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (let i = 1; i <= n; i++) {
      ids.add(volumeId(i));
      emails.add(volumeEmail(i));
      phones.add(volumePhone(i));
    }
    expect([ids.size, emails.size, phones.size]).toEqual([n, n, n]);
    expect(volumeId(1)).toMatch(/^5eed0000-0000-4000-8000-[0-9a-f]{12}$/);
    expect(volumeEmail(7)).toBe("vol-7@exemplo.invalid");
    expect(volumePhone(1)).toMatch(/^\+55119\d{8}$/);
    expect(volumePhone(500000)).toMatch(/^\+55119\d{8}$/);
    expect(volumeName(3)).toMatch(/^\p{L}+ (Exemplo|Teste|Modelo|Demo|Fictício) 3$/u);
  });
  it("o telefone não colide com os 50 do seed pequeno (+55119000000xx)", () => {
    for (let i = 1; i <= 500000; i += 997) expect(volumePhone(i)).not.toMatch(/^\+55119000000\d{2}$/);
  });
});

describe("buildVolumePerson", () => {
  const people = Array.from({ length: 6000 }, (_, i) => buildVolumePerson(i + 1, catalog, 1));
  it("é determinístico e depende da semente", () => {
    expect(buildVolumePerson(42, catalog, 1)).toEqual(buildVolumePerson(42, catalog, 1));
    expect(buildVolumePerson(42, catalog, 1)).not.toEqual(buildVolumePerson(42, catalog, 2));
  });
  it("tem de 1 a 8 habilidades distintas do catálogo, a maioria entre 2 e 4", () => {
    for (const p of people) {
      expect(p.skillIds.length).toBeGreaterThanOrEqual(1);
      expect(p.skillIds.length).toBeLessThanOrEqual(8);
      expect(new Set(p.skillIds).size).toBe(p.skillIds.length);
      expect(p.skillIds.every((id) => SKILLS.includes(id))).toBe(true);
    }
    const middle = people.filter((p) => p.skillIds.length >= 2 && p.skillIds.length <= 4).length;
    expect(middle / people.length).toBeGreaterThan(0.55);
    expect(new Set(people.map((p) => p.skillIds.length))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  });
  it("a capital pesa mais, e todos os municípios aparecem", () => {
    const share = (code: number) => people.filter((p) => p.municipalityCode === code).length / people.length;
    expect(share(3550308)).toBeGreaterThan(0.3);
    expect(share(3550308)).toBeGreaterThan(share(3548708));
    expect(share(3548708)).toBeGreaterThan(share(3529401));
    expect(new Set(people.map((p) => p.municipalityCode)).size).toBe(catalog.municipalities.length);
  });
  it("casa e equipe vêm do catálogo; sem catálogo de casas ou equipes, ficam nulas", () => {
    expect(people.every((p) => catalog.houseKeys.includes(p.houseKey as string))).toBe(true);
    expect(people.every((p) => catalog.teamUnitIds.includes(p.teamUnitId as string))).toBe(true);
    const none = buildVolumePerson(1, { ...catalog, houseKeys: [], teamUnitIds: [] }, 1);
    expect([none.houseKey, none.teamUnitId]).toEqual([null, null]);
  });
  it("recusa catálogo sem município ou com menos de 8 habilidades", () => {
    expect(() => buildVolumePerson(1, { ...catalog, municipalities: [] }, 1)).toThrow(RangeError);
    expect(() => buildVolumePerson(1, { ...catalog, skillIds: SKILLS.slice(0, 5) }, 1)).toThrow(RangeError);
  });
});

describe("batchRanges", () => {
  it("divide 1..N em lotes sem sobra nem repetição", () => {
    expect(batchRanges(10, 4)).toEqual([
      [1, 4],
      [5, 8],
      [9, 10],
    ]);
    const all = batchRanges(2000, 700).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k));
    expect(all).toEqual(Array.from({ length: 2000 }, (_, i) => i + 1));
  });
});

describe("copyField", () => {
  it("escapa tab, quebra de linha e barra, e escreve NULL como \\N", () => {
    expect(copyField("a\tb\nc\\d")).toBe("a\\tb\\nc\\\\d");
    expect(copyField(null)).toBe("\\N");
    expect(copyField(12)).toBe("12");
  });
});

describe("buildBatchSql", () => {
  const contexts: { table: string; column: string; rowId: string }[] = [];
  const crypto = {
    encrypt: async (plain: string, context: { table: string; column: string; rowId: string }) => {
      contexts.push(context);
      return `v1.AAAAAAAAAAAAAAAA.${Buffer.from(plain).toString("base64url")}XXXXXXXXXXXXXXXXXXXXXXXX`;
    },
    blindIndex: async (whatsapp: string) => Buffer.from(whatsapp).toString("hex").padEnd(64, "0").slice(0, 64),
  };
  const batch = [1, 2, 3].map((i) => buildVolumePerson(i, catalog, 1));

  it("cifra o nome e o WhatsApp de cada pessoa com o contexto da própria linha (AAD)", async () => {
    contexts.length = 0;
    await buildBatchSql(batch, { crypto, consentVersion: "v1" });
    expect(contexts).toEqual(
      batch.flatMap((p) => [
        { table: "profiles", column: "display_name_enc", rowId: p.id },
        { table: "profile_contacts", column: "whatsapp_enc", rowId: p.id },
      ]),
    );
  });

  it("monta uma transação com COPY por tabela e inserção idempotente", async () => {
    const sql = await buildBatchSql(batch, { crypto, consentVersion: "v1" });
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql.match(/\\\.\n/g)?.length).toBeGreaterThanOrEqual(4);
    for (const table of [
      "auth.users",
      "public.profiles",
      "public.consent_acceptances",
      "public.profile_contacts",
      "public.profile_skills",
      "public.house_members",
      "public.unit_members",
    ]) {
      expect(sql).toContain(`insert into ${table}`);
    }
    expect(sql).toContain("on conflict do nothing");
    for (const p of batch) {
      expect(sql).toContain(p.id);
      expect(sql).toContain(p.email);
    }
  });

  it("não escreve nome nem telefone em claro: só o valor cifrado e o índice cego", async () => {
    const sql = await buildBatchSql(batch, { crypto, consentVersion: "v1" });
    for (const p of batch) {
      expect(sql).not.toContain(p.name);
      expect(sql).not.toContain(p.whatsapp);
    }
  });

  it("uma pessoa sem casa ou equipe não gera linha dessas tabelas", async () => {
    const lone = buildVolumePerson(1, { ...catalog, houseKeys: [], teamUnitIds: [] }, 1);
    const sql = await buildBatchSql([lone], { crypto, consentVersion: "v1" });
    expect(sql).not.toMatch(/copy v_houses/);
    expect(sql).not.toMatch(/copy v_teams/);
  });
});

describe("cleanSql", () => {
  it("apaga só as contas do domínio fictício deste seed", () => {
    const sql = cleanSql();
    expect(sql).toContain("delete from auth.users");
    expect(sql).toContain("vol-%@exemplo.invalid");
    expect(sql).not.toMatch(/truncate/i);
  });
});
