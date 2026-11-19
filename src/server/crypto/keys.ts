import "server-only";
import { decodeKey, getEnv, parsePreviousKeys, type ServerEnv } from "../env";
import { FieldCryptoError } from "./errors";

/** Bytes crus das chaves, antes de importar no Web Crypto. */
export type KeyMaterial = {
  /** Versão usada para cifrar. As demais em `fieldKeys` só decifram (rotação). */
  currentVersion: number;
  fieldKeys: ReadonlyMap<number, Uint8Array>;
  blindIndexKey: Uint8Array;
};

/** Chaves importadas como não extraíveis: nem o próprio processo consegue exportá-las. */
export type Keyring = {
  readonly currentVersion: number;
  readonly fieldKeys: ReadonlyMap<number, CryptoKey>;
  readonly blindIndexKey: CryptoKey;
};

const KEY_BYTES = 32;
const MAX_VERSION = 999;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export async function importKeyring(material: KeyMaterial): Promise<Keyring> {
  const fieldRaw = [...material.fieldKeys.entries()];
  const validVersion = (v: number) => Number.isInteger(v) && v >= 1 && v <= MAX_VERSION;
  if (
    !material.fieldKeys.has(material.currentVersion) ||
    !fieldRaw.every(([v, k]) => validVersion(v) && k.length === KEY_BYTES) ||
    material.blindIndexKey.length !== KEY_BYTES ||
    // HMAC e AES com a mesma chave anulariam a separação pedida no ADR 0003 §2.
    fieldRaw.some(([, k]) => sameBytes(k, material.blindIndexKey))
  ) {
    throw new FieldCryptoError("invalid_key");
  }

  const fieldKeys = new Map<number, CryptoKey>();
  for (const [version, raw] of fieldRaw) {
    fieldKeys.set(version, await crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  const blindIndexKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(material.blindIndexKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { currentVersion: material.currentVersion, fieldKeys, blindIndexKey };
}

/** Monta as chaves a partir do ambiente já validado por `parseEnv` (src/server/env.ts). */
export function keyMaterialFromEnv(env: ServerEnv): KeyMaterial {
  const field = env.FIELD_ENCRYPTION_KEY ? decodeKey(env.FIELD_ENCRYPTION_KEY) : null;
  const blind = env.BLIND_INDEX_KEY ? decodeKey(env.BLIND_INDEX_KEY) : null;
  if (!field || !blind) throw new FieldCryptoError("missing_key");
  const previous = env.FIELD_ENCRYPTION_PREVIOUS_KEYS ? parsePreviousKeys(env.FIELD_ENCRYPTION_PREVIOUS_KEYS) : new Map<number, Uint8Array>();
  if (!previous) throw new FieldCryptoError("invalid_key");
  const fieldKeys = new Map(previous);
  fieldKeys.set(env.FIELD_ENCRYPTION_KEY_VERSION, field);
  return { currentVersion: env.FIELD_ENCRYPTION_KEY_VERSION, fieldKeys, blindIndexKey: blind };
}

let cached: Promise<Keyring> | undefined;

/** Chaves do ambiente, importadas uma vez. Falha com `missing_key` se não estiverem configuradas. */
export function getKeyring(): Promise<Keyring> {
  cached ??= Promise.resolve()
    .then(() => importKeyring(keyMaterialFromEnv(getEnv())))
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}

/** Só para testes que trocam o ambiente com `vi.stubEnv`. */
export function resetKeyringCache(): void {
  cached = undefined;
}
