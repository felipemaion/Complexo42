// Exportação dos próprios dados no servidor (issue #20). Chama `export_own_data` com o JWT da
// pessoa (R14; nunca service_role), decifra em src/server/crypto (R13) e devolve o arquivo.
// O conteúdo nunca vai para log (R11): só códigos de evento e de erro.
import "server-only";
import { instance } from "@config/instance";
import { decryptField } from "@/server/crypto";
import { log as appLog, type Logger } from "@/server/log";
import { activityRowsSchema, buildActivityExport } from "../domain/activity";
import { buildOwnDataExport, exportFilename, ownDataRowsSchema, serializeExport, type DecryptFn } from "../domain/export";
import type { ExportOwnDataResult, PrivacyDbClient } from "../types";

export type ExportDeps = { decrypt: DecryptFn; log: Logger; now: () => Date };

const defaultDeps: ExportDeps = { decrypt: decryptField, log: appLog, now: () => new Date() };

/** Só o código do erro (Postgres/PostgREST), nunca a mensagem. */
function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code.slice(0, 16) : "unknown";
}

/**
 * Tudo o que a plataforma guarda sobre `user` (quem está logado: o banco confere de novo com
 * `auth.uid()`), num JSON legível. A 6ª exportação na mesma hora volta `rate_limited`.
 */
export async function exportOwnData(
  client: PrivacyDbClient,
  user: { id: string; email: string | null },
  deps: ExportDeps = defaultDeps,
): Promise<ExportOwnDataResult> {
  const { data, error } = await client.rpc("export_own_data", {});
  if (error) {
    const code = errorCode(error);
    if (code === "54000") {
      deps.log.warn("data_export_rate_limited");
      return { status: "rate_limited" };
    }
    deps.log.error("data_export_failed", { reason: code });
    return { status: "failed" };
  }
  const rows = ownDataRowsSchema.safeParse(data);
  if (!rows.success) {
    // Só os caminhos dos campos, nunca os valores.
    deps.log.error("data_export_failed", { reason: "unexpected_shape", fields: rows.error.issues.map((i) => i.path.join(".")) });
    return { status: "failed" };
  }
  const at = deps.now();
  const file = await buildOwnDataExport({
    rows: rows.data,
    userId: user.id,
    loginEmail: user.email,
    generatedAt: at,
    description: instance.myData.fileDescription,
    houseNames: Object.fromEntries(instance.houses.map((h) => [h.id, h.name])),
    decrypt: deps.decrypt,
    onDecryptError: (column) => deps.log.warn("data_export_decrypt_failed", { column }),
  });
  // Atividade (medalhas, portfólio, pontos, entregas, mensagens): função irmã, mesmo JWT. Se falhar,
  // a exportação toda falha: o arquivo nunca sai incompleto sem aviso.
  const activityResponse = await client.rpc("export_own_activity", {});
  if (activityResponse.error) {
    deps.log.error("data_export_failed", { reason: `activity_${errorCode(activityResponse.error)}` });
    return { status: "failed" };
  }
  const activityRows = activityRowsSchema.safeParse(activityResponse.data);
  if (!activityRows.success) {
    deps.log.error("data_export_failed", { reason: "unexpected_activity_shape", fields: activityRows.error.issues.map((i) => i.path.join(".")) });
    return { status: "failed" };
  }
  const atividade = await buildActivityExport(activityRows.data, user.id, deps.decrypt, (column) =>
    deps.log.warn("data_export_decrypt_failed", { column }),
  );
  const complete = { ...file, atividade };
  deps.log.info("data_exported");
  return { status: "ok", body: serializeExport(complete), filename: exportFilename(at) };
}
