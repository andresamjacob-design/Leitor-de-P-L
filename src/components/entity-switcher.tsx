"use client";

import { usePathname, useRouter } from "next/navigation";
import { CONSOLIDATED_SLUG, type Entity } from "@/lib/entity-types";

/**
 * Switches entity by rewriting the first URL segment, so the current screen is preserved
 * and the link stays shareable (DECISIONS D19).
 */
export function EntitySwitcher({
  entities,
  current,
}: {
  entities: Entity[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function change(slug: string) {
    const rest = pathname.split("/").slice(2).join("/");
    router.push(`/${slug}${rest ? `/${rest}` : ""}`);
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Entidade</span>
      <select
        value={current}
        onChange={(event) => change(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        aria-label="Entidade"
      >
        {entities.map((entity) => (
          <option key={entity.id} value={entity.slug}>
            {entity.name}
          </option>
        ))}
        {entities.length > 1 ? (
          <option value={CONSOLIDATED_SLUG}>Consolidado</option>
        ) : null}
      </select>
    </label>
  );
}
