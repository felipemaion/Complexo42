"use server";
// Server action do envio da lista de autorizados (#26, ADR 0008 §1). Só composição: sessão
// (JWT de quem está logado, R14) + serviço do módulo de acesso. O arquivo é lido em memória,
// vira HMACs e é descartado: nada é gravado em disco nem vai para o log (R11). Quem decide se
// a pessoa pode importar é o banco (`import_allowlist` → 42501), não esta tela (R15).
import {
  ALLOWLIST_FILE_FIELD,
  ALLOWLIST_SOURCE_FIELD,
  AccessError,
  AllowlistImportError,
  allowlistLimits,
  importAllowlist,
  invalidLinesReturnedMax,
  isAllowedAllowlistFileName,
  parseAllowlistSource,
  type AllowlistUploadState,
} from "@/modules/access";
import { requireUserClient } from "@/server/auth/session";
import { log } from "@/server/log";

export async function importAllowlistAction(_previous: AllowlistUploadState, formData: FormData): Promise<AllowlistUploadState> {
  const { client } = await requireUserClient();
  const file = formData.get(ALLOWLIST_FILE_FIELD);
  if (!(file instanceof File) || file.size === 0) return { status: "error", error: "no_file" };
  if (!isAllowedAllowlistFileName(file.name)) return { status: "error", error: "wrong_type" };
  // Recusa antes de decodificar e analisar o texto. Não é proteção contra DoS: quando a action
  // roda, o corpo já chegou inteiro (o teto é o bodySizeLimit do next.config.ts e o proxy de
  // borda, #86). Aqui é só a regra do tamanho máximo da lista.
  if (file.size > allowlistLimits.maxBytes) return { status: "error", error: "too_large" };
  const source = parseAllowlistSource(formData.get(ALLOWLIST_SOURCE_FIELD));
  if (!source) return { status: "error", error: "invalid_source" };

  try {
    const { received, promoted, invalidLines } = await importAllowlist(client, await file.text(), source);
    log.info("allowlist_import_done", { received, promoted, invalid_lines: invalidLines.length });
    return {
      status: "done",
      received,
      promoted,
      invalidLines: invalidLines.slice(0, invalidLinesReturnedMax),
      invalidLineCount: invalidLines.length,
    };
  } catch (err) {
    if (err instanceof AllowlistImportError) return { status: "error", error: err.code };
    if (err instanceof AccessError && err.code === "forbidden") return { status: "error", error: "forbidden" };
    // Só o código: nunca a mensagem, que poderia trazer um trecho do arquivo.
    const reason = err instanceof AccessError ? err.code : err instanceof Error ? err.name : "unknown";
    log.error("allowlist_import_failed", { reason });
    return { status: "error", error: "failed" };
  }
}
