import type { InstanceConfig } from "@/modules/instance";

export type TeamParent = {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
};

export type TeamSummary = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string;
  readonly parentName: string;
  readonly memberCount: number;
};

export type TeamMember = {
  readonly profileId: string;
  readonly displayName: string;
  readonly isLead: boolean;
};

export type PersonOption = {
  readonly profileId: string;
  readonly displayName: string;
};

export type TeamsClient = {
  readonly rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};

export type TeamsText = InstanceConfig["teams"];

export type TeamErrorCode = "not_allowed" | "invalid" | "failed";

export type TeamActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: TeamErrorCode };
