"use server";
// "Ver contato" (#48, ADR 0010). Só composição: sessão (JWT, R14), Zod na entrada e `viewMemberContact`; o banco decide
// quem vê, registra o acesso (sem o valor) e limita a 60 pessoas por hora. O valor decifrado só volta no resultado
// desta chamada, nunca em URL, lista nem log. Entrada inválida e "sem permissão" dão a mesma resposta.
import { contactKinds, viewMemberContact, viewStateFromContact, type ContactKind, type ViewContactState } from "@/modules/profiles";
import { requireUserClient } from "@/server/auth/session";

const isKind = (value: unknown): value is ContactKind => typeof value === "string" && (contactKinds as readonly string[]).includes(value);

export async function viewContactAction(_previous: ViewContactState, formData: FormData): Promise<ViewContactState> {
  const { client } = await requireUserClient();
  const target = formData.get("alvo");
  const kind = formData.get("tipo");
  if (!isKind(kind)) return { status: "forbidden", kind: "whatsapp" };
  if (typeof target !== "string") return { status: "forbidden", kind };
  const result = await viewMemberContact(client, target, kind);
  if (result.status === "ok") return viewStateFromContact(kind, result.contact);
  return { status: result.status, kind };
}
