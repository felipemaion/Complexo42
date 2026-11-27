import type { InstanceConfig } from "@/modules/instance";

export type SkillOption = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
};

export type PersonResult = {
  readonly profileId: string;
  readonly displayName: string;
  readonly municipalityCode: number | null;
  readonly skillNames: readonly string[];
};

export type SearchQueryResult<T = unknown> = Promise<{
  readonly data: T | null;
  readonly error: unknown;
}>;

export type SearchQuery = {
  readonly eq: (column: string, value: unknown) => SearchQuery;
  readonly order: (column: string, options?: { readonly ascending?: boolean }) => SearchQuery;
  readonly then: <TResult1 = { readonly data: unknown; readonly error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { readonly data: unknown; readonly error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
};

export type SearchClient = {
  readonly rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
  readonly from: (table: string) => { readonly select: (columns: string) => SearchQuery };
};

export type SearchText = InstanceConfig["search"];

export type SearchActionResult<T = void> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: "invalid" | "failed" };
