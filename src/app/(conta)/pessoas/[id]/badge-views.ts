import type { ReactNode } from "react";
import type { HouseClient } from "@/modules/houses";
import type { BadgeKind } from "@/modules/public-profile";

// Como cada medalha vira tela no perfil público (#305). Ponto de ligação: uma entrada por tipo, que lê o que
// precisa com o cliente de quem olha (a RLS decide) e devolve o nó, ou null se a pessoa não tem a medalha.
// `totem`: ligar à `readMemberTotems` + `ChosenHouseAndTotem` quando o #327 entrar; `house`, idem. Tipo sem
// entrada não aparece (nada é inventado).
export type BadgeView = (client: HouseClient, personId: string) => Promise<ReactNode | null>;

export const badgeViews: Partial<Record<BadgeKind, BadgeView>> = {};
