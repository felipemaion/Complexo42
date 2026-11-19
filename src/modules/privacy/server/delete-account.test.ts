// Serviço do "Excluir minha conta" (#18): confere a palavra antes de chamar o banco, traduz a
// recusa por login antigo (PT401) e nunca põe dado da pessoa no log. O banco (só a conta de
// quem chama, login recente, nada sobra) é testado em supabase/tests/delete_own_account.test.sql.
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/server/log";
import { deleteOwnAccount } from "./delete-account";
import type { PrivacyDbClient } from "../types";

const USER = "0b6f2d4e-3c1a-4f8e-9d2b-7a5c6e1f0a93";
const EMAIL = "maria@exemplo.org";

function setup(error: { code?: string; message?: string } | null = null) {
  const rpc = vi.fn(async () => ({ data: null, error }));
  const lines: string[] = [];
  const log = createLogger(undefined, (line) => lines.push(line));
  return { client: { rpc } as unknown as PrivacyDbClient, rpc, lines, deps: { log } };
}

describe("deleteOwnAccount", () => {
  it("palavra certa: chama delete_own_account sem parâmetro (o banco usa auth.uid())", async () => {
    const { client, rpc, deps, lines } = setup();
    expect(await deleteOwnAccount(client, { confirmation: "excluir" }, deps)).toEqual({ status: "deleted" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_own_account", {});
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["account_deleted"]);
  });

  it("palavra errada: não chama o banco", async () => {
    const { client, rpc, deps } = setup();
    for (const confirmation of ["", "sim", null, "EXCLUI"]) {
      expect(await deleteOwnAccount(client, { confirmation }, deps)).toEqual({ status: "invalid_confirmation" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("login antigo (PT401 do banco): pede para entrar de novo", async () => {
    const { client, deps, lines } = setup({ code: "PT401", message: "entre de novo" });
    expect(await deleteOwnAccount(client, { confirmation: "EXCLUIR" }, deps)).toEqual({ status: "reauth_required" });
    expect(JSON.parse(lines[0]!).event).toBe("account_delete_reauth_required");
  });

  it("outro erro: falha, e o log leva só o código", async () => {
    const { client, deps, lines } = setup({ code: "42501", message: `conta ${USER} de ${EMAIL}` });
    expect(await deleteOwnAccount(client, { confirmation: "EXCLUIR" }, deps)).toEqual({ status: "failed" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "account_delete_failed", reason: "42501" });
  });

  it("R11: nenhum caminho põe o id, o e-mail ou a mensagem do banco no log", async () => {
    const all: string[] = [];
    for (const error of [null, { code: "PT401", message: EMAIL }, { code: "XX000", message: `${USER} ${EMAIL}` }, { message: EMAIL }]) {
      const { client, deps, lines } = setup(error);
      await deleteOwnAccount(client, { confirmation: "EXCLUIR" }, deps);
      all.push(...lines);
    }
    expect(all).toHaveLength(4);
    const text = all.join("\n");
    expect(text).not.toContain(USER);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("maria");
  });
});
