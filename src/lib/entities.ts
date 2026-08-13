import { CONSOLIDATED_SLUG, type Entity } from "@/lib/entity-types";
import { createClient } from "@/lib/supabase/server";

export { CONSOLIDATED_SLUG };
export type { Entity };

/**
 * Entity resolution for the `/[entity]/...` routes (DECISIONS D19).
 *
 * Note on data access: application reads go through the Supabase client so the user's JWT
 * travels with them and RLS applies. Drizzle owns the schema, the migrations and the seed
 * — it is never used to serve a request, because a direct connection would bypass the
 * policies that make SPEC §11.6 true.
 */

export type EntityScope =
  | { kind: "entity"; entity: Entity }
  | { kind: "consolidated"; entities: Entity[] };

export async function listUserEntities(): Promise<Entity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entities")
    .select("id, slug, name, legal_name, tax_id")
    .eq("active", true)
    .order("name");

  if (error) throw new Error(`não foi possível carregar as entidades: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    taxId: row.tax_id,
  }));
}

/** Resolves a URL segment into a scope, or null when the user has no access to it. */
export async function resolveScope(slug: string): Promise<EntityScope | null> {
  const entities = await listUserEntities();

  if (slug === CONSOLIDATED_SLUG) {
    // Consolidated is only meaningful across more than one entity.
    if (entities.length < 2) return null;
    return { kind: "consolidated", entities };
  }

  const entity = entities.find((candidate) => candidate.slug === slug);
  return entity ? { kind: "entity", entity } : null;
}

export function scopeLabel(scope: EntityScope): string {
  return scope.kind === "consolidated" ? "Consolidado" : scope.entity.name;
}

export function scopeSlug(scope: EntityScope): string {
  return scope.kind === "consolidated" ? CONSOLIDATED_SLUG : scope.entity.slug;
}
