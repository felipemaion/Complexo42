// Seed em volume (#74): tamanho pedido, pessoas 100% fictícias e a trava de "nunca em produção".
// O banco em si (contas, perfis, equipes, missões e pontos) é conferido rodando o script; a medição
// fica em scripts/seed-volume-explain.sql e em docs/TESTES.md.
import { describe, expect, it } from "vitest";
import { buildFakePeople, fakePeopleCount } from "../scripts/fake-people.mjs";
import { assertSafeTarget, MAX_VOLUME, parseVolumeCount, VOLUME_SIZES, volumePerson } from "../scripts/volume-people.mjs";

describe("seed em volume (#74)", () => {
  it("lê o tamanho de --n, com 2000 como padrão e os três tamanhos de referência", () => {
    // Arrange / Act / Assert
    expect(parseVolumeCount([])).toBe(2000);
    expect(parseVolumeCount(["--n", "50000"])).toBe(50000);
    expect(VOLUME_SIZES).toEqual([2000, 50000, 500000]);
    expect(parseVolumeCount(["--n", String(MAX_VOLUME)])).toBe(500000);
  });

  it("recusa tamanho fora do intervalo ou que não é número inteiro", () => {
    for (const raw of ["0", "-1", "500001", "1.5", "muitos"]) {
      expect(() => parseVolumeCount(["--n", raw])).toThrow(RangeError);
    }
  });

  it("gera pessoas fictícias: e-mail de exemplo, nome de teste e telefone no bloco do projeto", () => {
    const first = volumePerson(0);
    const last = volumePerson(MAX_VOLUME - 1);

    expect(first).toEqual({ email: "volume-000001@example.com", name: "Ana Volume 000001", whatsapp: "+5511900100000" });
    expect(last.email).toBe("volume-500000@example.com");
    expect(last.whatsapp).toBe("+5511900599999");
    expect(() => volumePerson(MAX_VOLUME)).toThrow(RangeError);
  });

  it("os telefones não colidem entre si nem com os 50 perfis do seed base", () => {
    const sample = Array.from({ length: 5000 }, (_, i) => volumePerson(i).whatsapp);
    const base = buildFakePeople(fakePeopleCount, { municipalityCount: 39, skillCount: 47 }).map((p) => p.whatsapp);

    expect(new Set(sample).size).toBe(sample.length);
    expect(sample.some((phone) => base.includes(phone))).toBe(false);
    expect(sample.every((phone) => /^\+5511900\d{6}$/.test(phone))).toBe(true);
  });

  it("nunca em produção: recusa NODE_ENV=production e banco que não é o staging informado", () => {
    const staging = "staging.complexo42.maionesys.com";
    expect(() => assertSafeTarget({ nodeEnv: "production" })).toThrow(/production/);
    expect(() => assertSafeTarget({ dbUrl: "postgresql://u:p@db.complexo42.maionesys.com:5432/postgres", stagingHost: staging })).toThrow(
      /staging informado/,
    );
    expect(() => assertSafeTarget({ dbUrl: "isto não é url", stagingHost: staging })).toThrow(/válido/);
    // Sem o host do staging declarado, nenhum endereço passa.
    expect(() => assertSafeTarget({ dbUrl: `postgresql://u:p@${staging}:5432/postgres` })).toThrow(/staging informado/);
  });

  it("fecha os atalhos: localhost (túnel), nome parecido e parâmetro que troca o servidor", () => {
    const staging = "staging.complexo42.maionesys.com";
    expect(() => assertSafeTarget({ dbUrl: "postgresql://postgres:postgres@127.0.0.1:5433/postgres", stagingHost: staging })).toThrow();
    expect(() => assertSafeTarget({ dbUrl: "postgresql://u:p@staging.prod.example.com/postgres", stagingHost: staging })).toThrow();
    for (const param of ["host", "hostaddr", "service"]) {
      expect(() => assertSafeTarget({ dbUrl: `postgresql://u:p@${staging}/postgres?${param}=prod`, stagingHost: staging })).toThrow(param);
    }
  });

  it("aceita o Supabase local (sem endereço: o container) e o staging de host exato", () => {
    const staging = "staging.complexo42.maionesys.com";
    expect(assertSafeTarget({ nodeEnv: "development" })).toBe("local");
    expect(assertSafeTarget({ dbUrl: `postgresql://u:p@${staging}:5432/postgres`, stagingHost: staging })).toBe("staging");
  });
});
