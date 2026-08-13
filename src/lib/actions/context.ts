/**
 * What every write needs to know: which entity, and who is writing.
 *
 * The entity comes from `resolveScope`, which only ever returns entities the user can
 * reach — and even if that were bypassed, the RLS `WITH CHECK` on every table would
 * refuse the insert. This is the convenient boundary; the database is the real one
 * (DECISIONS D16).
 *
 * Writes always target one entity: `consolidado` is a reading lens, not a place to save
 * into.
 */

import { resolveScope, type Entity } from "@/lib/entities";
import { getUser } from "@/lib/supabase/server";
import { FormError } from "@/lib/form";

export type WriteContext = {
  entity: Entity;
  userId: string;
};

export async function requireWriteContext(slug: string): Promise<WriteContext> {
  const user = await getUser();
  if (!user) throw new FormError("sua sessão expirou. Entre de novo.");

  const scope = await resolveScope(slug);
  if (!scope) throw new FormError("entidade não encontrada.");
  if (scope.kind === "consolidated") {
    throw new FormError(
      "o consolidado é só de leitura — escolha uma entidade para lançar.",
    );
  }

  return { entity: scope.entity, userId: user.id };
}
