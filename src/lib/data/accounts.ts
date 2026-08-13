/**
 * Accounts. Read and written through the Supabase client, so the user's JWT travels with
 * every query and RLS decides what is visible (DECISIONS D16).
 *
 * Money crosses the boundary here and nowhere else: `numeric(14,2)` becomes `bigint`
 * cents on the way in, and back to a numeric string on the way out.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { AccountType } from "@/lib/ledger-types";

export type Account = {
  id: string;
  entityId: string;
  name: string;
  type: AccountType;
  institution: string | null;
  branch: string | null;
  number: string | null;
  lastDigits: string | null;
  openingBalance: Cents;
  openingDate: IsoDate;
  active: boolean;
};

type AccountRow = {
  id: string;
  entity_id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  branch: string | null;
  number: string | null;
  last_digits: string | null;
  opening_balance: string;
  opening_date: string;
  active: boolean;
};

const COLUMNS =
  "id, entity_id, name, type, institution, branch, number, last_digits, opening_balance, opening_date, active";

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    entityId: row.entity_id,
    name: row.name,
    type: row.type,
    institution: row.institution,
    branch: row.branch,
    number: row.number,
    lastDigits: row.last_digits,
    openingBalance: fromNumeric(row.opening_balance),
    openingDate: row.opening_date,
    active: row.active,
  };
}

export async function listAccounts(
  entityIds: string[],
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<Account[]> {
  if (entityIds.length === 0) return [];

  const supabase = await createClient();
  let query = supabase.from("accounts").select(COLUMNS).in("entity_id", entityIds);
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query.order("type").order("name");
  if (error) throw new Error(`não foi possível carregar as contas: ${error.message}`);

  return (data as AccountRow[]).map(toAccount);
}

export async function getAccount(id: string): Promise<Account | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar a conta: ${error.message}`);
  return data ? toAccount(data as AccountRow) : null;
}

/**
 * Current balance per account: opening balance plus every movement since.
 *
 * For a credit card this is what is owed, not cash — which is exactly why the cash flow
 * leaves card accounts out (DECISIONS D-C).
 */
export async function accountBalances(
  accounts: readonly Account[],
  { until }: { until?: IsoDate } = {},
): Promise<Map<string, Cents>> {
  const balances = new Map<string, Cents>(
    accounts.map((account) => [account.id, account.openingBalance]),
  );
  if (accounts.length === 0) return balances;

  const supabase = await createClient();
  let query = supabase
    .from("cash_entries")
    .select("account_id, amount, direction")
    .in(
      "account_id",
      accounts.map((account) => account.id),
    );
  if (until) query = query.lte("occurred_on", until);

  const { data, error } = await query.limit(50000);
  if (error) throw new Error(`não foi possível calcular os saldos: ${error.message}`);

  for (const row of data as { account_id: string; amount: string; direction: "in" | "out" }[]) {
    const current = balances.get(row.account_id);
    if (current === undefined) continue;
    const value = fromNumeric(row.amount);
    balances.set(row.account_id, current + (row.direction === "in" ? value : -value));
  }

  return balances;
}

export type AccountInput = {
  name: string;
  type: AccountType;
  institution: string | null;
  branch: string | null;
  number: string | null;
  lastDigits: string | null;
  openingBalance: Cents;
  openingDate: IsoDate;
  active: boolean;
};

export async function createAccount(entityId: string, input: AccountInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({ entity_id: entityId, ...toRow(input) })
    .select("id")
    .single();

  if (error) throw new Error(`não foi possível criar a conta: ${error.message}`);
  return (data as { id: string }).id;
}

export async function updateAccount(id: string, input: AccountInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("accounts").update(toRow(input)).eq("id", id);
  if (error) throw new Error(`não foi possível salvar a conta: ${error.message}`);
}

function toRow(input: AccountInput) {
  return {
    name: input.name,
    type: input.type,
    institution: input.institution,
    branch: input.branch,
    number: input.number,
    last_digits: input.lastDigits,
    opening_balance: toNumeric(input.openingBalance),
    opening_date: input.openingDate,
    active: input.active,
  };
}
