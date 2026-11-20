export const GRADES = ["bronze", "prata", "ouro"] as const;

export type Grade = (typeof GRADES)[number];

export type CollabErrorCode = "not_allowed" | "invalid" | "too_many" | "failed";

export type CollabResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: CollabErrorCode };

export type CollabClient = {
  readonly rpc: (
    fn: string,
    args?: Readonly<Record<string, unknown>>,
  ) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};

export type MyTeam = {
  readonly teamId: string;
  readonly teamName: string;
};

export type TeamMate = {
  readonly profileId: string;
  readonly displayName: string;
  readonly isLead: boolean;
};

export type ChatMessage = {
  readonly messageId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
  readonly isMine: boolean;
};

export type DashboardRow = {
  readonly teamId: string;
  readonly teamName: string;
  readonly memberCount: number;
  readonly activeRuns: number;
  readonly completedRuns: number;
  readonly teamPoints: number;
};
