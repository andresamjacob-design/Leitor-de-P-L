"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SideNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}`;

  return (
    <nav aria-label="Seções" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const href = `${base}${item.href}`;
        const active = item.href === "" ? pathname === base : pathname.startsWith(href);

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
