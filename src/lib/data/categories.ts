/**
 * The chart of accounts. Same access rule as everything else: Supabase client, user JWT,
 * RLS decides (DECISIONS D16).
 *
 * `dreGroup` plus `sortOrder` is what reproduces the line ordering of the `DRE Geral`
 * sheet the company already works from — the P&L in Fase 6 depends on it, and so does
 * the row order of the cash flow.
 */

import { createClient } from "@/lib/supabase/server";
import type { CategoryKind } from "@/lib/ledger-types";
import { chunk, UUID_BATCH } from "@/lib/data/batching";

export type Category = {
  id: string;
  entityId: string;
  code: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  dreGroup: string | null;
  sortOrder: number;
  active: boolean;
};

type CategoryRow = {
  id: string;
  entity_id: string;
  code: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  dre_group: string | null;
  sort_order: number;
  active: boolean;
};

const COLUMNS = "id, entity_id, code, name, kind, parent_id, dre_group, sort_order, active";

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    entityId: row.entity_id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    dreGroup: row.dre_group,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

export async function listCategories(
  entityIds: string[],
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Category[]> {
  if (entityIds.length === 0) return [];

  const supabase = await createClient();
  let query = supabase.from("categories").select(COLUMNS).in("entity_id", entityIds);
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query.order("sort_order").order("code");
  if (error) throw new Error(`não foi possível carregar o plano de contas: ${error.message}`);

  return (data as CategoryRow[]).map(toCategory);
}

export async function getCategory(id: string): Promise<Category | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar a categoria: ${error.message}`);
  return data ? toCategory(data as CategoryRow) : null;
}

export type CategoryInput = {
  code: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  dreGroup: string | null;
  sortOrder: number;
  active: boolean;
};

export async function createCategory(
  entityId: string,
  input: CategoryInput,
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({ entity_id: entityId, ...toRow(input) })
    .select("id")
    .single();

  if (error) throw new Error(translate(error.message));
  return (data as { id: string }).id;
}

export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("categories").update(toRow(input)).eq("id", id);
  if (error) throw new Error(translate(error.message));
}

/**
 * A category with movement behind it is never deleted — the entries would lose their
 * classification and the history would change retroactively. It is deactivated instead,
 * which the `restrict` foreign key on `cash_entries.category_id` also enforces.
 */
export async function deactivateCategory(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("categories").update({ active: false }).eq("id", id);
  if (error) throw new Error(`não foi possível desativar a categoria: ${error.message}`);
}

/** How many cash entries point at a category — what makes deletion unsafe. */
export async function countEntriesByCategory(
  categoryIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (categoryIds.length === 0) return counts;

  const supabase = await createClient();
  for (const batch of chunk(categoryIds, UUID_BATCH)) {
    const { data, error } = await supabase
      .from("cash_entries")
      .select("category_id")
      .in("category_id", batch);

    if (error) throw new Error(`não foi possível contar os lançamentos: ${error.message}`);

    for (const row of data as { category_id: string | null }[]) {
      if (!row.category_id) continue;
      counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
    }
  }
  return counts;
}

function toRow(input: CategoryInput) {
  return {
    code: input.code,
    name: input.name,
    kind: input.kind,
    parent_id: input.parentId,
    dre_group: input.dreGroup,
    sort_order: input.sortOrder,
    active: input.active,
  };
}

function translate(message: string): string {
  if (message.includes("categories_entity_code_key")) {
    return "já existe uma categoria com este código nesta entidade.";
  }
  return `não foi possível salvar a categoria: ${message}`;
}
