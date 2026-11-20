"use client";
// Menu do site em abas: links grandes, sempre visíveis (nada escondido em menu sanfona, ata de
// 17/11 §10; no celular as abas quebram linha), com a página atual marcada por cor, pelo traço
// embaixo E por aria-current (não só pela cor).
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { readonly href: string; readonly label: string; readonly count?: number };

export function NavLinks({ items, label }: { readonly items: readonly Item[]; readonly label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="border-t border-line">
      <ul className="mx-auto flex w-full max-w-site flex-wrap gap-x-1 px-3">
        {items.map((item) => {
          const isCurrent = item.href === "/inicio" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`inline-flex min-h-14 items-center gap-2 border-b-4 px-3 text-lg font-semibold no-underline ${
                  isCurrent ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {item.label}
                {item.count ? (
                  <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-secondary px-2 text-base font-bold text-on-secondary">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
