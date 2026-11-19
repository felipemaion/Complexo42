"use server";
// Server action da tela de bloqueio (#26, ADR 0008 §1). Só composição: sessão (JWT, R14),
// leitura do pedido e `setMemberBlock`. "Continuar" só abre a confirmação; só "Sim" chama o
// banco, que decide quem pode (R15) e responde igual exista ou não a conta. A tela, portanto,
// também não diz se alguém foi bloqueado. O e-mail não vai para o log (R11).
import {
  AccessError,
  MEMBER_BLOCK_FIELDS,
  parseMemberBlockRequest,
  parseMemberBlockStep,
  setMemberBlock,
  type MemberBlockState,
} from "@/modules/access";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

export async function memberBlockAction(_state: MemberBlockState, formData: FormData): Promise<MemberBlockState> {
  const { client } = await requireUserClient();
  const step = parseMemberBlockStep(formData.get(MEMBER_BLOCK_FIELDS.step));
  if (step === "cancelar") return { status: "idle" };
  const parsed = parseMemberBlockRequest(formData);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  if (step === "preparar") return { status: "confirm", request: parsed.request };
  try {
    await setMemberBlock(client, parsed.request);
    return { status: "done", action: parsed.request.action };
  } catch (err) {
    if (err instanceof AccessError && err.code === "forbidden") return { status: "error", error: "forbidden" };
    log.error("member_block_failed", { reason: err instanceof AccessError ? err.code : "unknown" });
    return { status: "error", error: "failed" };
  }
}
