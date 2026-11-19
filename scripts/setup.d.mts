// Tipos de scripts/setup.mjs para os testes (o tsconfig não usa allowJs).
export declare function ensureEnvFile(root: string): { created: boolean; path: string };
export declare function fillAnonKey(content: string, anonKey: string): { content: string; filled: boolean };
