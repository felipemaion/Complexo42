"use client";
// Menu do site: links grandes, sempre visíveis (nada escondido em menu sanfona, ata de 17/11
// §10), com a página atual marcada por cor E por aria-current (não só pela cor).
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { readonly href: string; readonly label: string };

export function NavLinks({ items, label }: { readonly items: readonly Item[]; readonly label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mx-auto max-w-3xl px-5 pb-3">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isCurrent = item.href === "/inicio" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`inline-flex min-h-12 items-center rounded-full border-2 px-4 text-lg font-semibold no-underline ${
                  isCurrent ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-primary"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
