"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SideNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}`;

  // The longest matching item wins, so `/contratos/poc` lights up "Reportar avanço" and
  // not also "Contratos" — a nested screen has exactly one place in the menu.
  const current = NAV_ITEMS.reduce<string | null>((best, item) => {
    const href = `${base}${item.href}`;
    const matches = item.href === "" ? pathname === base : pathname.startsWith(href);
    if (!matches) return best;
    return best === null || href.length > best.length ? href : best;
  }, null);

  return (
    <nav aria-label="Seções" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const href = `${base}${item.href}`;
        const active = href === current;

        return (
          <Link
            key={item.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent-soft font-medium text-accent"
                : "text-muted hover:bg-surface hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
