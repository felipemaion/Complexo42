import { brandInitials } from "../domain/initials";

type BrandMarkProps = {
  readonly shortName: string;
};

export function BrandMark({ shortName }: BrandMarkProps) {
  const initials = brandInitials(shortName);

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary font-bold text-on-primary"
    >
      {initials}
      <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-secondary" />
    </span>
  );
}
