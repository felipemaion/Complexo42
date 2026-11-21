import "server-only";
import { z } from "zod";
import {
  BADGE_ICONS,
  type BadgeActionResult,
  type BadgeAward,
  type BadgeErrorCode,
  type BadgeOption,
  type BadgesClient,
} from "../types";

const badgeOptionRow = z.object({
  id: z.guid(),
  name: z.string(),
  description: z.string(),
  icon: z.enum(BADGE_ICONS),
});

const badgeOptionRows = z.array(badgeOptionRow);

const badgeAwardRow = z.object({
  award_id: z.guid(),
  name: z.string(),
  description: z.string(),
  icon: z.enum(BADGE_ICONS),
  reason: z.string(),
  awarded_at: z.string(),
});

const badgeAwardRows = z.array(badgeAwardRow);

// Campo vazio do formulário vira "não informado".
const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

// Como se ganha a medalha (#36): manual (a coordenação dá) ou automática (missão concluída /
// limite de pontos), concedida pelo banco.
const createBadgeSchema = z
  .strictObject({
    scopeUnitId: z.guid(),
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300),
    icon: z.enum(BADGE_ICONS),
    rule: z.enum(["manual", "event", "milestone", "points_threshold", "mission_completed"]).default("manual"),
    points: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100000).optional()),
    missionId: z.preprocess(emptyToUndefined, z.guid().optional()),
  })
  .refine((input) => input.rule !== "points_threshold" || input.points !== undefined)
  .refine((input) => input.rule !== "mission_completed" || input.missionId !== undefined);

const grantBadgeSchema = z.strictObject({
  badgeId: z.guid(),
  profileId: z.guid(),
  reason: z.string().trim().min(3).max(300),
});

const revokeBadgeSchema = z.strictObject({
  awardId: z.guid(),
  reason: z.string().trim().min(3).max(300),
});

function mapDatabaseError(error: unknown): BadgeErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { readonly code?: unknown }).code);
    if (code === "42501") return "not_allowed";
    if (code === "22023") return "invalid";
    if (code === "23505") return "already_has";
    if (code === "C7612") return "already_revoked";
  }
  return "failed";
}

export async function readBadgeOptions(
  client: BadgesClient,
): Promise<readonly BadgeOption[]> {
  const { data, error } = await client.rpc("badge_options");
  if (error) throw new Error("badges_read_failed");

  const parsed = badgeOptionRows.safeParse(data);
  if (!parsed.success) throw new Error("badges_read_failed");

  return parsed.data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
  }));
}

export async function readMyBadges(
  client: BadgesClient,
  profileId: string,
): Promise<readonly BadgeAward[]> {
  const { data, error } = await client.rpc("profile_badge_list", {
    p_profile: profileId,
  });
  if (error) throw new Error("badges_read_failed");

  const parsed = badgeAwardRows.safeParse(data);
  if (!parsed.success) throw new Error("badges_read_failed");

  return parsed.data.map((row) => ({
    awardId: row.award_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    reason: row.reason,
    awardedAt: row.awarded_at,
  }));
}

export async function createBadge(
  client: BadgesClient,
  input: unknown,
): Promise<BadgeActionResult> {
  const parsed = createBadgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { rule, scopeUnitId, name, description, icon } = parsed.data;
  const base = { p_scope_unit: scopeUnitId, p_name: name, p_description: description, p_icon: icon };
  const { error } =
    rule === "manual"
      ? await client.rpc("create_badge", base)
      : rule === "event" || rule === "milestone"
        ? await client.rpc("create_special_badge", { ...base, p_rule_type: rule })
        : await client.rpc("create_auto_badge", {
          ...base,
          p_rule_type: rule,
          p_mission: rule === "mission_completed" ? (parsed.data.missionId ?? null) : null,
          p_points: rule === "points_threshold" ? (parsed.data.points ?? null) : null,
        });

  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}

export async function grantBadge(
  client: BadgesClient,
  input: unknown,
): Promise<BadgeActionResult> {
  const parsed = grantBadgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { error } = await client.rpc("grant_badge", {
    p_badge: parsed.data.badgeId,
    p_profile: parsed.data.profileId,
    p_reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}

export async function revokeBadge(
  client: BadgesClient,
  input: unknown,
): Promise<BadgeActionResult> {
  const parsed = revokeBadgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { error } = await client.rpc("revoke_badge", {
    p_award: parsed.data.awardId,
    p_reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: mapDatabaseError(error) };
  return { ok: true };
}
