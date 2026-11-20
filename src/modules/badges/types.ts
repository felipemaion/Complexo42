import type { InstanceConfig } from "@/modules/instance";

export const BADGE_ICONS = [
  "estrela",
  "trofeu",
  "fogo",
  "livro",
  "megafone",
  "camera",
  "coracao",
  "escudo",
] as const;

export type BadgeIcon = (typeof BADGE_ICONS)[number];

export type BadgeOption = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: BadgeIcon;
};

export type BadgeAward = {
  readonly awardId: string;
  readonly name: string;
  readonly description: string;
  readonly icon: BadgeIcon;
  readonly reason: string;
  readonly awardedAt: string;
};

export type BadgesClient = {
  readonly rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};

export type BadgesText = InstanceConfig["badges"];

export type BadgeErrorCode =
  | "not_allowed"
  | "invalid"
  | "already_has"
  | "already_revoked"
  | "failed";

export type BadgeActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: BadgeErrorCode };
