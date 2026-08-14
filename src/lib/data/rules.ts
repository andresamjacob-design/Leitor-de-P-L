/**
 * Categorisation rules, and everything the engine needs to run.
 *
 * The engine itself is pure (`lib/categorize/engine.ts`); this is the part that talks to
 * the database, so the decision logic stays testable without one.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import { normalizeTaxId } from "@/lib/tax-id";
import type { MatchType, Rule, HistoryEntry, Person } from "@/lib/categorize/types";

const COLUMNS =
  "id, priority, match_type, pattern, counterparty_tax_id, amount_min, amount_max, account_id, category_id, client_id, person_id, active, hit_count";

type RuleRow = {
  id: string;
  priority: number;
  match_type: MatchType;
  pattern: string;
  counterparty_tax_id: string | null;
  amount_min: string | null;
  amount_max: string | null;
  account_id: string | null;
  category_id: string;
  client_id: string | null;
  person_id: string | null;
  active: boolean;
  hit_count: number;
};

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    priority: row.priority,
    matchType: row.match_type,
    pattern: row.pattern,
    counterpartyTaxId: row.counterparty_tax_id,
    amountMin: row.amount_min === null ? null : fromNumeric(row.amount_min),
    amountMax: row.amount_max === null ? null : fromNumeric(row.amount_max),
    accountId: row.account_id,
    categoryId: row.category_id,
    clientId: row.client_id,
    personId: row.person_id,
    active: row.active,
    hitCount: row.hit_count,
  };
}

export async function listRules(
  entityIds: string[],
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Rule[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  let query = supabase.from("categorization_rules").select(COLUMNS).in("entity_id", entityIds);
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query.order("priority").order("id");
  if (error) throw new Error(`não foi possível carregar as regras: ${error.message}`);
  return (data as RuleRow[]).map(toRule);
}

export async function getRule(id: string): Promise<Rule | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categorization_rules")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar a regra: ${error.message}`);
  return data ? toRule(data as RuleRow) : null;
}

export type RuleInput = {
  priority: number;
  matchType: MatchType;
  pattern: string;
  counterpartyTaxId: string | null;
  amountMin: Cents | null;
  amountMax: Cents | null;
  accountId: string | null;
  categoryId: string;
  clientId: string | null;
  personId: string | null;
  active: boolean;
};

function toRow(input: RuleInput) {
  return {
    priority: input.priority,
    match_type: input.matchType,
    pattern: input.pattern,
    counterparty_tax_id: input.counterpartyTaxId
      ? normalizeTaxId(input.counterpartyTaxId)
      : null,
    amount_min: input.amountMin === null ? null : toNumeric(input.amountMin),
    amount_max: input.amountMax === null ? null : toNumeric(input.amountMax),
    account_id: input.accountId,
    category_id: input.categoryId,
    client_id: input.clientId,
    person_id: input.personId,
    active: input.active,
  };
}

export async function createRule(entityId: string, input: RuleInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categorization_rules")
    .insert({ entity_id: entityId, ...toRow(input) })
    .select("id")
    .single();

  if (error) throw new Error(`não foi possível criar a regra: ${error.message}`);
  return (data as { id: string }).id;
}

export async function updateRule(id: string, input: RuleInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("categorization_rules").update(toRow(input)).eq("id", id);
  if (error) throw new Error(`não foi possível salvar a regra: ${error.message}`);
}

export async function deleteRule(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("categorization_rules").delete().eq("id", id);
  if (error) throw new Error(`não foi possível apagar a regra: ${error.message}`);
}

/**
 * Counts a rule's uses. The number is what tells a dead rule from a load-bearing one when
 * the list grows past what anyone remembers writing.
 */
export async function countRuleHits(hits: Map<string, number>): Promise<void> {
  if (hits.size === 0) return;
  const supabase = await createClient();

  for (const [id, increment] of hits) {
    const { data } = await supabase
      .from("categorization_rules")
      .select("hit_count")
      .eq("id", id)
      .maybeSingle();

    const current = (data as { hit_count: number } | null)?.hit_count ?? 0;
    await supabase
      .from("categorization_rules")
      .update({ hit_count: current + increment })
      .eq("id", id);
  }
}

// ---------------------------------------------------------------------------
// What the engine learns from
// ---------------------------------------------------------------------------

/**
 * Movements that already carry a category. Capped and newest-first: the engine only ever
 * uses the most recent decision per counterparty and per description, so older rows would
 * change nothing while making every import slower.
 */
export async function loadHistory(entityIds: string[]): Promise<HistoryEntry[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("cash_entries")
    .select("description, counterparty_tax_id, category_id, client_id, person_id, occurred_on")
    .in("entity_id", entityIds)
    .not("category_id", "is", null)
    .order("occurred_on", { ascending: false })
    .limit(5000);

  if (error) throw new Error(`não foi possível carregar o histórico: ${error.message}`);

  return (
    data as {
      description: string;
      counterparty_tax_id: string | null;
      category_id: string;
      client_id: string | null;
      person_id: string | null;
      occurred_on: string;
    }[]
  ).map((row) => ({
    description: row.description,
    counterpartyTaxId: row.counterparty_tax_id,
    categoryId: row.category_id,
    clientId: row.client_id,
    personId: row.person_id,
    occurredOn: row.occurred_on,
  }));
}

export async function listPeople(entityIds: string[]): Promise<Person[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select("id, name")
    .in("entity_id", entityIds)
    .eq("active", true);

  if (error) throw new Error(`não foi possível carregar as pessoas: ${error.message}`);
  return data as Person[];
}
