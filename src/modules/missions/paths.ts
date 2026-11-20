// Endereços das telas de missões. O id da missão só entra no caminho depois de validado.
import { z } from "zod";

export const MISSIONS_PATH = "/missoes";
export const MISSION_REVIEW_PATH = "/coordenacao/missoes";
export const MISSION_PUBLISH_PATH = "/coordenacao/missoes/publicar";

/** Caminho da missão; id que não é uuid volta para a lista (nunca monta URL com texto solto). */
export function missionPath(missionId: unknown): string {
  const parsed = z.guid().safeParse(missionId);
  return parsed.success ? `${MISSIONS_PATH}/${parsed.data}` : MISSIONS_PATH;
}
