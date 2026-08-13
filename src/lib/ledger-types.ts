/**
 * Shapes shared by the pure ledger logic, the data layer and the screens.
 *
 * Kept free of `drizzle-orm` and `next/headers` on purpose: the cash flow builder is a
 * pure function tested in Vitest, and the entity switcher is a client component. Neither
 * should have to pull a database driver into its bundle.
 */

export type CategoryKind =
  | "revenue"
  | "cost"
  | "expense"
  | "tax"
  | "transfer"
  | "owner_draw";

export type EntryDirection = "in" | "out";

export type AccountType = "bank" | "credit_card" | "cash" | "investment";

/**
 * Where real money sits. A credit card is a liability holding account: a purchase on it
 * is a cost the moment it happens, but no cash moves until the bill is paid (D-C).
 * Leaving it out of the cash flow is what keeps R$ 1.200 of purchases plus a R$ 1.200
 * bill payment from reading as R$ 2.400 of spend.
 */
export const CASH_ACCOUNT_TYPES = ["bank", "cash", "investment"] as const;

export function isCashAccount(type: AccountType): boolean {
  return (CASH_ACCOUNT_TYPES as readonly string[]).includes(type);
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: "Conta corrente",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
  investment: "Aplicação",
};

export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = {
  revenue: "Receita",
  cost: "Custo direto",
  expense: "Despesa",
  tax: "Imposto",
  transfer: "Transferência",
  owner_draw: "Sócios",
};

export const DIRECTION_LABEL: Record<EntryDirection, string> = {
  in: "Entrada",
  out: "Saída",
};

/** The P&L line ordering the company already works from (`DRE Geral`). */
export const DRE_GROUP_LABEL: Record<string, string> = {
  receita_bruta: "Receita bruta",
  deducoes: "Deduções",
  custos_diretos: "Custos diretos",
  pessoal: "Pessoal",
  ferramentas: "Ferramentas e assinaturas",
  servicos: "Serviços de terceiros",
  viagem: "Viagem e representação",
  outras: "Outras despesas",
  financeiras: "Financeiras",
  transferencias: "Transferências",
  socios: "Sócios",
};

export const DRE_GROUP_ORDER = [
  "receita_bruta",
  "deducoes",
  "custos_diretos",
  "pessoal",
  "ferramentas",
  "servicos",
  "viagem",
  "outras",
  "financeiras",
  "socios",
  "transferencias",
] as const;
