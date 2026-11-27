import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signMessage } from "./result-signature";

describe("signMessage", () => {
  it("é o HMAC-SHA256 em hex da mensagem (o banco confere o mesmo valor)", () => {
    const expected = createHmac("sha256", "chave-de-teste").update("result|u|termo|casa|AB|1", "utf8").digest("hex");
    expect(signMessage("chave-de-teste", "result|u|termo|casa|AB|1")).toBe(expected);
    expect(signMessage("chave-de-teste", "result|u|termo|casa|AB|1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("muda com a chave e com qualquer campo da mensagem", () => {
    const base = signMessage("k1", "result|u|termo|casa|AB|1");
    expect(signMessage("k2", "result|u|termo|casa|AB|1")).not.toBe(base);
    expect(signMessage("k1", "result|u|termo|casa|BA|1")).not.toBe(base);
    expect(signMessage("k1", "result|v|termo|casa|AB|1")).not.toBe(base);
  });
});
