export type VolumeArgs = { count: number; seed: number; clean: boolean; simLocal: boolean; db: string };
export type VolumeCatalog = {
  municipalities: { code: number }[];
  skillIds: string[];
  houseKeys: string[];
  teamUnitIds: string[];
};
export type VolumePerson = {
  index: number;
  id: string;
  email: string;
  name: string;
  whatsapp: string;
  municipalityCode: number;
  skillIds: string[];
  houseKey: string | null;
  teamUnitId: string | null;
};
export type VolumeCrypto = {
  encrypt(plain: string, context: { table: string; column: string; rowId: string }): Promise<string>;
  blindIndex(whatsapp: string): Promise<string>;
};
export const volumeSizes: readonly number[];
export const volumeEmailDomain: string;
export const defaultVolumeDb: string;
export function parseVolumeArgs(argv: readonly string[]): VolumeArgs;
export function readDbPort(configToml: string): number;
export function assertLocalTarget(input: { dbUrl: string; localPort: number; simLocal: boolean; nodeEnv?: string }): void;
export function isFictionalEmail(email: string): boolean;
export function volumeId(index: number): string;
export function volumeEmail(index: number): string;
export function volumePhone(index: number): string;
export function volumeName(index: number): string;
export function buildVolumePerson(index: number, catalog: VolumeCatalog, seed?: number): VolumePerson;
export function batchRanges(count: number, size?: number): [number, number][];
export function copyField(value: string | number | null): string;
export function buildBatchSql(people: readonly VolumePerson[], options: { crypto: VolumeCrypto; consentVersion: string }): Promise<string>;
export function cleanSql(): string;
