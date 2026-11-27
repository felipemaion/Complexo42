// Preferência de som (UX "nível Awwwards", 22/11): desligado até a pessoa ligar, e lembrado só neste
// navegador. Puro e testável: o armazenamento entra por parâmetro e qualquer falha (aba anônima, site
// bloqueado) vira "desligado", nunca um erro na tela.

export const SOUND_KEY = "c42-som";

export type KeyValueStore = {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
};

export function readSoundOn(store: KeyValueStore | null | undefined): boolean {
  try {
    return store?.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSoundOn(store: KeyValueStore | null | undefined, on: boolean): void {
  try {
    store?.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    // Sem onde guardar: o som vale só até a página fechar.
  }
}
