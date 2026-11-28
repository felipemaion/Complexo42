// Medalhas do perfil público (#305): quais tipos existem, o padrão e a leitura do formulário do dono.
// Pura (sem banco, sem Next): o que o banco aceita está no CHECK de `profile_badge_prefs`.

export const badgeKinds = ["house", "totem"] as const;
export type BadgeKind = (typeof badgeKinds)[number];

export type BadgePref = { kind: BadgeKind; shown: boolean };

/** Sem escolha do dono, vale esta ordem, tudo visível (o mesmo padrão de `public_profile`). */
export const defaultBadgePrefs: readonly BadgePref[] = badgeKinds.map((kind) => ({ kind, shown: true }));

export const isBadgeKind = (value: unknown): value is BadgeKind => typeof value === "string" && (badgeKinds as readonly string[]).includes(value);

export const badgeOrderField = (kind: BadgeKind) => `ordem-${kind}`;
export const badgeShownField = (kind: BadgeKind) => `mostrar-${kind}`;

type FormLike = { get(name: string): unknown };

/**
 * Lê o formulário: cada tipo tem uma posição (inteiro de 1 a 99) e uma caixa "mostrar". Posição repetida
 * desempata pela ordem padrão; posição ausente ou fora da faixa invalida o envio (null).
 */
export function parseBadgeForm(form: FormLike): BadgePref[] | null {
  const rows: { kind: BadgeKind; position: number; shown: boolean; index: number }[] = [];
  for (const [index, kind] of badgeKinds.entries()) {
    const raw = form.get(badgeOrderField(kind));
    const position = typeof raw === "string" && /^\d{1,2}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
    if (!Number.isInteger(position) || position < 1) return null;
    rows.push({ kind, position, shown: form.get(badgeShownField(kind)) !== null, index });
  }
  return rows.sort((a, b) => a.position - b.position || a.index - b.index).map(({ kind, shown }) => ({ kind, shown }));
}

/** Junta o que está salvo com os tipos que a pessoa ainda não ordenou (tipo novo entra no fim, visível). */
export function completeBadgePrefs(saved: readonly BadgePref[]): BadgePref[] {
  const seen = new Set(saved.map((pref) => pref.kind));
  return [...saved, ...badgeKinds.filter((kind) => !seen.has(kind)).map((kind) => ({ kind, shown: true }))];
}
