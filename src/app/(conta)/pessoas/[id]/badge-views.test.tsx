// Medalhas do perfil público (#305): na ordem que o dono escolheu, sem a que ele desligou nem a que não resolve, e o
// totem entra só como código e nome (decifrado no servidor por `readMemberTotems`).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readMemberTotems = vi.fn<(client: unknown, ids: readonly string[], deps: unknown) => Promise<Map<string, string>>>();

vi.mock("server-only", () => ({}));
vi.mock("@/modules/houses", async () => {
  const medal = await vi.importActual<{ ChosenHouseAndTotem: unknown }>("@/modules/houses/components/totem-medal");
  return {
    ChosenHouseAndTotem: medal.ChosenHouseAndTotem,
    coordinationViewDeps: () => ({ crypto: {}, questionnaire: { totemLabels: { XV: { name: "Totem Teste", description: "d" } } } }),
    readMemberTotems,
  };
});
vi.mock("@/server/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { badgeViews, resolveBadges } = await import("./badge-views");

const PERSON = "00000000-0000-4000-8000-000000000001";
const client = {} as never;

beforeEach(() => {
  readMemberTotems.mockReset();
});

describe("resolveBadges", () => {
  it("mantém a ordem do dono e só as medalhas que resolvem", async () => {
    const views = { house: async () => "casa", totem: async () => "totem" };
    expect((await resolveBadges(client, PERSON, ["totem", "house"], views)).map((b) => b.kind)).toEqual(["totem", "house"]);
    expect((await resolveBadges(client, PERSON, ["house", "totem"], views)).map((b) => b.kind)).toEqual(["house", "totem"]);
  });

  it("esconde a medalha que o dono desligou (ela nem vem na lista) e a que não resolve", async () => {
    const views = { house: async () => null, totem: async () => "totem" };
    expect((await resolveBadges(client, PERSON, ["totem"], views)).map((b) => b.kind)).toEqual(["totem"]);
    expect(await resolveBadges(client, PERSON, ["house"], views)).toEqual([]);
  });

  it("tipo sem entrada não aparece", async () => {
    expect(await resolveBadges(client, PERSON, ["house"], {})).toEqual([]);
  });
});

describe("medalha do totem", () => {
  it("lê o totem da pessoa e mostra a medalha com o nome", async () => {
    readMemberTotems.mockResolvedValue(new Map([[PERSON, "XV"]]));
    const node = await badgeViews.totem!(client, PERSON);
    expect(readMemberTotems).toHaveBeenCalledWith(client, [PERSON], expect.anything());
    const html = renderToStaticMarkup(<>{node}</>);
    expect(html).toContain("Totem Teste");
    expect(html).toContain("/totens/xv-");
  });

  it("sem totem ou com falha na leitura, sem medalha (a página não quebra)", async () => {
    readMemberTotems.mockResolvedValue(new Map());
    expect(await badgeViews.totem!(client, PERSON)).toBeNull();
    readMemberTotems.mockRejectedValue(new Error("member_totems_failed:42501"));
    expect(await badgeViews.totem!(client, PERSON)).toBeNull();
  });

  it("a medalha da casa de outra pessoa ainda não tem leitura própria", () => {
    expect(badgeViews.house).toBeUndefined();
  });
});
