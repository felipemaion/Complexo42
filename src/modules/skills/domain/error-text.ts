/**
 * O texto de erro de uma tela de habilidades a partir de `?erro=`. O valor vem da URL, então só vale chave
 * que o próprio mapa tem (`Object.hasOwn`): `?erro=constructor` ou `?erro=toString` caem em `failed`.
 */
export function skillErrorText(errors: Readonly<Record<string, string>> & { failed: string }, key: string | undefined): string | null {
  if (!key) return null;
  return Object.hasOwn(errors, key) ? errors[key]! : errors.failed;
}
