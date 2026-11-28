import type { ReactNode } from "react";
import { ChosenHouseAndTotem, coordinationViewDeps, readMemberTotems, type HouseClient } from "@/modules/houses";
import type { BadgeKind } from "@/modules/public-profile";
import { log } from "@/server/log";

// Como cada medalha vira tela no perfil público (#305). Uma entrada por tipo: lê o que precisa com o cliente de quem
// olha (a RLS e as funções do banco decidem) e devolve o nó, ou null se a pessoa não tem a medalha.
// `totem` (#303): `readMemberTotems` decifra no servidor e entrega só o código; a tela recebe código e nome.
// `house`: a casa de OUTRA pessoa não é legível para um membro comum (RLS de `house_members`), então fica sem entrada
// até existir uma função própria, como a do totem. Tipo sem entrada não aparece (nada é inventado).
export type BadgeView = (client: HouseClient, personId: string) => Promise<ReactNode | null>;

const totemView: BadgeView = async (client, personId) => {
  const deps = coordinationViewDeps();
  const codes = await readMemberTotems(client, [personId], {
    crypto: deps.crypto,
    questionnaire: deps.questionnaire,
    onUnreadable: (count) => log.warn("member_totems_unreadable", { count }),
  }).catch((error: unknown) => {
    // Só o motivo curto: nunca id, valor cifrado nem mensagem do banco.
    log.warn("member_totems_failed", { reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
    return null;
  });
  const code = codes?.get(personId) ?? null;
  if (code === null) return null;
  return <ChosenHouseAndTotem houseId={null} houseName="" totemCode={code} totemName={deps.questionnaire.totemLabels[code]?.name ?? ""} />;
};

export const badgeViews: Partial<Record<BadgeKind, BadgeView>> = { totem: totemView };

/** As medalhas na ordem do dono (a lista já vem filtrada pelo banco); a que não resolve some. */
export async function resolveBadges(
  client: HouseClient,
  personId: string,
  kinds: readonly BadgeKind[],
  views: Partial<Record<BadgeKind, BadgeView>> = badgeViews,
): Promise<{ kind: BadgeKind; node: ReactNode }[]> {
  const resolved = await Promise.all(
    kinds.map(async (kind) => {
      const view = views[kind];
      return { kind, node: view ? await view(client, personId) : null };
    }),
  );
  return resolved.filter((badge) => badge.node !== null);
}
