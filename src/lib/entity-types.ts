/**
 * Entity shapes shared by server and client code.
 *
 * Kept apart from `entities.ts` on purpose: that module reaches for `next/headers` and
 * cannot be pulled into a client bundle, and the entity switcher is a client component.
 */

export const CONSOLIDATED_SLUG = "consolidado";

export type Entity = {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  taxId: string | null;
};
