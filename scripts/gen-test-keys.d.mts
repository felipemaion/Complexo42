// Tipos de scripts/gen-test-keys.mjs para os testes (o tsconfig não usa allowJs).
export declare const KEY_NAMES: readonly string[];
export declare function generateKey(): string;
export declare function fillTestKeys(content: string, gen?: () => string): { content: string; filled: string[] };
export declare function fillTestKeysInFile(file: string): string[];
