"use server";

import { redirect } from "next/navigation";
import {
  BADGES_PATH,
  createBadge,
  grantBadge,
  sessionBadgesClient,
} from "@/modules/badges";
import { requireUser } from "@/server/auth/session";
import { log } from "@/server/log";

export async function createBadgeAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionBadgesClient();
  if (!client) redirect(`${BADGES_PATH}?erro=failed`);

  const result = await createBadge(client, {
    scopeUnitId: formData.get("scopeUnitId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    icon: formData.get("icon"),
  });

  if (!result.ok) log.warn("badge_action_refused", { reason: result.error });
  redirect(`${BADGES_PATH}?${result.ok ? "ok=created" : `erro=${result.error}`}`);
}

export async function grantBadgeAction(formData: FormData): Promise<void> {
  await requireUser();
  const client = await sessionBadgesClient();
  if (!client) redirect(`${BADGES_PATH}?erro=failed`);

  const result = await grantBadge(client, {
    badgeId: formData.get("badgeId"),
    profileId: formData.get("profileId"),
    reason: formData.get("reason"),
  });

  if (!result.ok) log.warn("badge_action_refused", { reason: result.error });
  redirect(`${BADGES_PATH}?${result.ok ? "ok=granted" : `erro=${result.error}`}`);
}
