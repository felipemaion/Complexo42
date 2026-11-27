export type VolumePerson = { email: string; name: string; whatsapp: string };
export const VOLUME_SIZES: number[];
export const MAX_VOLUME: number;
export function parseVolumeCount(argv: string[]): number;
export function volumePerson(index: number): VolumePerson;
export function assertSafeTarget(target: { nodeEnv?: string; dbUrl?: string; stagingHost?: string }): "local" | "staging";
