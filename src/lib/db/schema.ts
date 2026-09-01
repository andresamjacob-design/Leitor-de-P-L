/**
 * Database schema. Drizzle is the single source of truth — every change here becomes a
 * versioned migration (DECISIONS D15). Tables are never edited by hand.
 *
 * Two rules run through the whole file:
 *   - every business table carries `entity_id` and has RLS on it (SPEC §3, D11);
 *   - money is `numeric(14,2)` and dates that mean a calendar day are `date` (D17, D18).
 *
 * The two ledgers are `cash_entries` and `recognition_entries`. They are linked, never
 * merged (SPEC §5).
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 18, scale: 8 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["owner", "member", "viewer"]);
export const accountType = pgEnum("account_type", ["bank", "credit_card", "cash", "investment"]);
export const categoryKind = pgEnum("category_kind", [
  "revenue",
  "cost",
  "expense",
  "tax",
  "transfer",
  "owner_draw",
]);
export const personKind = pgEnum("person_kind", ["employee", "contractor", "partner"]);
/** From the `Colaboradores` sheet, which tracks this separately from `kind`. */
export const personBond = pgEnum("person_bond", ["clt", "pj", "freelancer", "estagio", "socio"]);
export const contractType = pgEnum("contract_type", ["retainer", "project"]);
export const contractStatus = pgEnum("contract_status", [
  "draft",
  "active",
  "completed",
  "cancelled",
]);
export const recognitionMethod = pgEnum("recognition_method", [
  "straight_line",
  "poc",
  "manual",
]);
export const entryDirection = pgEnum("entry_direction", ["in", "out"]);
export const recognitionKind = pgEnum("recognition_kind", ["revenue", "cost"]);
/**
 * `cash_mirror` is the automatic accrual of a cash cost into its own month (D2a).
 * `accrual` is a provision with no cash behind it yet — unused today, see DECISIONS Q3.
 */
export const recognitionSource = pgEnum("recognition_source", [
  "engine",
  "manual",
  "cash_mirror",
  "accrual",
]);
export const importFormat = pgEnum("import_format", ["ofx", "csv", "xlsx", "pdf"]);
export const importStatus = pgEnum("import_status", [
  "parsing",
  "reviewing",
  "approved",
  "discarded",
  "failed",
]);
export const stagedStatus = pgEnum("staged_status", [
  "pending",
  "approved",
  "rejected",
  "duplicate",
]);
export const suggestionSource = pgEnum("suggestion_source", ["rule", "ai", "none"]);
export const matchType = pgEnum("match_type", ["contains", "regex", "exact", "amount_range"]);
export const invoiceStatus = pgEnum("invoice_status", [
  "issued",
  "partially_paid",
  "paid",
  "cancelled",
]);
export const transferKind = pgEnum("transfer_kind", [
  "card_payment",
  "investment",
  "internal",
]);

// ---------------------------------------------------------------------------
// Entities and access
// ---------------------------------------------------------------------------

export const entities = pgTable("entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** URL segment — `/dd-group/fluxo-de-caixa` (D19). */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  taxId: text("tax_id"),
  currency: text("currency").notNull().default("BRL"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}).enableRLS();

export const userEntities = pgTable(
  "user_entities",
  {
    userId: uuid("user_id").notNull(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    /** Nothing is gated on this today (D7); it exists so it does not need a retrofit. */
    role: userRole("role").notNull().default("owner"),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.entityId] })],
).enableRLS();

// ---------------------------------------------------------------------------
// Chart of accounts and counterparties
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    institution: text("institution"),
    branch: text("branch"),
    number: text("number"),
    lastDigits: text("last_digits"),
    openingBalance: money("opening_balance").notNull().default("0"),
    openingDate: date("opening_date").notNull(),
    currency: text("currency").notNull().default("BRL"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index("accounts_entity_idx").on(table.entityId)],
).enableRLS();

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    parentId: uuid("parent_id"),
    /** Drives the P&L line ordering (SPEC §6). */
    dreGroup: text("dre_group"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    unique("categories_entity_code_key").on(table.entityId, table.code),
    index("categories_entity_idx").on(table.entityId),
  ],
).enableRLS();

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** The Itaú statement carries the counterparty CNPJ — this is what it matches. */
    taxId: text("tax_id"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    index("clients_entity_idx").on(table.entityId),
    index("clients_tax_id_idx").on(table.entityId, table.taxId),
  ],
).enableRLS();

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Cargo, from the `Cargos` sheet. */
    role: text("role"),
    kind: personKind("kind").notNull(),
    bond: personBond("bond"),
    squad: text("squad"),
    managerName: text("manager_name"),
    /** The `Colaboradores` sheet allocates people to a client. See DECISIONS Q7. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    taxId: text("tax_id"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index("people_entity_idx").on(table.entityId)],
).enableRLS();

// ---------------------------------------------------------------------------
// Contracts, invoices, recognition
// ---------------------------------------------------------------------------

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: contractType("type").notNull(),
    status: contractStatus("status").notNull().default("draft"),
    /**
     * Which revenue account this contract recognises into, when the type is not enough.
     *
     * Null means "decide from the type" — `3.01` for a retainer, `3.02` for a project,
     * which is right for every contract that is client work. It stops being right for the
     * two rows of the `DRE Geral` that are not: a referral commission belongs in `3.03`
     * and a partner share in `3.04`, and the chart carries both precisely because the
     * sheet has them.
     */
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    totalValue: money("total_value"),
    monthlyValue: money("monthly_value"),
    currency: text("currency").notNull().default("BRL"),
    /** Set only when the contract is priced in another currency (D5). */
    amountOriginal: money("amount_original"),
    fxRate: rate("fx_rate"),
    fxRateDate: date("fx_rate_date"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    billingTerms: text("billing_terms"),
    paymentTerms: text("payment_terms"),
    recognitionMethod: recognitionMethod("recognition_method").notNull(),
    /** Prorate partial months by days, or bill them whole (SPEC §9, D14f). */
    prorateFirstLastMonth: boolean("prorate_first_last_month").notNull().default(true),
    /** Amendments version the contract instead of rewriting history (D13). */
    parentContractId: uuid("parent_contract_id"),
    version: integer("version").notNull().default(1),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    isIntercompany: boolean("is_intercompany").notNull().default(false),
    sourceFileId: text("source_file_id"),
    /** LLM draft. Never trusted until a human confirms it (SPEC §9). */
    extractedJson: jsonb("extracted_json"),
    confirmedBy: uuid("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("contracts_entity_idx").on(table.entityId),
    index("contracts_client_idx").on(table.clientId),
  ],
).enableRLS();

export const contractItems = pgTable(
  "contract_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    value: money("value").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (table) => [index("contract_items_contract_idx").on(table.contractId)],
).enableRLS();

/**
 * Notas fiscais. The system records NFs issued elsewhere and reconciles them against
 * cash — it never issues one (D6, and SPEC §13 stays intact).
 *
 * `servicePeriod` is what drives competência, not `issueDate`.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    number: text("number").notNull(),
    series: text("series"),
    issueDate: date("issue_date").notNull(),
    servicePeriod: date("service_period").notNull(),
    dueDate: date("due_date"),
    status: invoiceStatus("status").notNull().default("issued"),
    grossAmount: money("gross_amount").notNull(),
    /** Withholdings: believed absent today, modelled so they need no migration (D6). */
    withheldIss: money("withheld_iss"),
    withheldIrrf: money("withheld_irrf"),
    withheldPis: money("withheld_pis"),
    withheldCofins: money("withheld_cofins"),
    withheldCsll: money("withheld_csll"),
    withheldInss: money("withheld_inss"),
    netAmount: money("net_amount"),
    currency: text("currency").notNull().default("BRL"),
    amountOriginal: money("amount_original"),
    fxRate: rate("fx_rate"),
    fxRateDate: date("fx_rate_date"),
    isIntercompany: boolean("is_intercompany").notNull().default(false),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("invoices_entity_number_key").on(table.entityId, table.number, table.series),
    index("invoices_entity_idx").on(table.entityId),
    index("invoices_period_idx").on(table.entityId, table.servicePeriod),
  ],
).enableRLS();

export const pocReports = pgTable(
  "poc_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    period: date("period").notNull(),
    /** Cumulative, 0–100. The engine stores this and computes the delta (SPEC §9). */
    percentCompleteCumulative: numeric("percent_complete_cumulative", {
      precision: 6,
      scale: 3,
    }).notNull(),
    /** Lets cumulative go down without tripping the monotonic check. */
    isCorrection: boolean("is_correction").notNull().default(false),
    reportedBy: uuid("reported_by"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
  },
  (table) => [
    unique("poc_reports_contract_period_key").on(table.contractId, table.period),
    index("poc_reports_entity_idx").on(table.entityId),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Statement ingestion
// ---------------------------------------------------------------------------

export const statementImports = pgTable(
  "statement_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    filename: text("filename").notNull(),
    fileHash: text("file_hash").notNull(),
    format: importFormat("format").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    /** Closing balance printed on the statement, to check the import against (SPEC §7). */
    statementClosingBalance: money("statement_closing_balance"),
    status: importStatus("status").notNull().default("parsing"),
    error: text("error"),
    importedBy: uuid("imported_by"),
    createdAt: createdAt(),
  },
  (table) => [index("statement_imports_entity_idx").on(table.entityId)],
).enableRLS();

export const stagedTransactions = pgTable(
  "staged_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    importId: uuid("import_id")
      .notNull()
      .references(() => statementImports.id, { onDelete: "cascade" }),
    rawJson: jsonb("raw_json"),
    externalId: text("external_id"),
    occurredOn: date("occurred_on").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    /** The Itaú statement carries both — the strongest categorisation signal in the file. */
    counterpartyName: text("counterparty_name"),
    counterpartyTaxId: text("counterparty_tax_id"),
    installmentCurrent: integer("installment_current"),
    installmentTotal: integer("installment_total"),
    suggestedCategoryId: uuid("suggested_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    suggestedClientId: uuid("suggested_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    suggestedPersonId: uuid("suggested_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    suggestionSource: suggestionSource("suggestion_source").notNull().default("none"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    dedupHash: text("dedup_hash").notNull(),
    status: stagedStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (table) => [
    index("staged_transactions_import_idx").on(table.importId),
    index("staged_transactions_entity_idx").on(table.entityId),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Ledger 1 — cash (regime de caixa)
// ---------------------------------------------------------------------------

export const cashEntries = pgTable(
  "cash_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    occurredOn: date("occurred_on").notNull(),
    /**
     * Competência override (D2b). Null means "the month of `occurred_on`", which is the
     * common case. It is set when the two regimes disagree — a salary paid in February
     * for January, a card bill paid in March for February's purchases.
     *
     * Always the first day of a month, like `recognition_entries.period`.
     */
    competencePeriod: date("competence_period"),
    amount: money("amount").notNull(),
    direction: entryDirection("direction").notNull(),
    description: text("description").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    vendor: text("vendor"),
    counterpartyName: text("counterparty_name"),
    counterpartyTaxId: text("counterparty_tax_id"),
    installmentCurrent: integer("installment_current"),
    installmentTotal: integer("installment_total"),
    externalId: text("external_id"),
    dedupHash: text("dedup_hash").notNull(),
    importId: uuid("import_id").references(() => statementImports.id, {
      onDelete: "set null",
    }),
    isIntercompany: boolean("is_intercompany").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    /** Entries stay editable (D-A); the audit trail is what makes that safe. */
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    unique("cash_entries_entity_dedup_key").on(table.entityId, table.dedupHash),
    index("cash_entries_entity_date_idx").on(table.entityId, table.occurredOn),
    index("cash_entries_account_idx").on(table.accountId),
  ],
).enableRLS();

/** Pairs the two sides of a transfer — the card bill debit and the card account (D14b). */
export const transferPairs = pgTable(
  "transfer_pairs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    fromCashEntryId: uuid("from_cash_entry_id")
      .notNull()
      .references(() => cashEntries.id, { onDelete: "cascade" }),
    toCashEntryId: uuid("to_cash_entry_id").references(() => cashEntries.id, {
      onDelete: "cascade",
    }),
    /** A card payment settles a whole statement, not one entry. */
    toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "set null" }),
    kind: transferKind("kind").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("transfer_pairs_from_key").on(table.fromCashEntryId),
    index("transfer_pairs_entity_idx").on(table.entityId),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Ledger 2 — recognition (regime de competência)
// ---------------------------------------------------------------------------

export const recognitionEntries = pgTable(
  "recognition_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    /** Always the first day of the month (D18). */
    period: date("period").notNull(),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    kind: recognitionKind("kind").notNull(),
    amount: money("amount").notNull(),
    method: recognitionMethod("method"),
    source: recognitionSource("source").notNull(),
    /** Set when this row mirrors a cash cost into its competência month (D2a). */
    cashEntryId: uuid("cash_entry_id").references(() => cashEntries.id, {
      onDelete: "cascade",
    }),
    pocReportId: uuid("poc_report_id").references(() => pocReports.id, {
      onDelete: "set null",
    }),
    /** The engine re-runs freely but never overwrites a row a human touched (D-A). */
    manuallyEdited: boolean("manually_edited").notNull().default(false),
    isIntercompany: boolean("is_intercompany").notNull().default(false),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    /** D12: `kind` is part of the key, or revenue and cost would collide. */
    unique("recognition_entries_engine_key").on(
      table.contractId,
      table.period,
      table.source,
      table.kind,
    ),
    index("recognition_entries_entity_period_idx").on(table.entityId, table.period),
    index("recognition_entries_contract_idx").on(table.contractId),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Categorisation and audit
// ---------------------------------------------------------------------------

export const categorizationRules = pgTable(
  "categorization_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    priority: integer("priority").notNull().default(100),
    matchType: matchType("match_type").notNull(),
    pattern: text("pattern").notNull(),
    /**
     * When set, the rule only applies to movements in that direction.
     *
     * Without it an expense rule fires on money coming in: `CICLO` matched five receipts
     * from a client that shares its name with an agency the company pays. Found on the
     * first real statement.
     */
    direction: entryDirection("direction"),
    /** A CNPJ match beats any text match — the statement gives it to us for free. */
    counterpartyTaxId: text("counterparty_tax_id"),
    amountMin: money("amount_min"),
    amountMax: money("amount_max"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    hitCount: integer("hit_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("categorization_rules_entity_priority_idx").on(table.entityId, table.priority),
  ],
).enableRLS();

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),
    /** A user id, or the string `system` for engine-written rows (D14g). */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityId, table.createdAt),
    index("audit_log_row_idx").on(table.tableName, table.rowId),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const entitiesRelations = relations(entities, ({ many }) => ({
  accounts: many(accounts),
  categories: many(categories),
  clients: many(clients),
  people: many(people),
  contracts: many(contracts),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  entity: one(entities, { fields: [contracts.entityId], references: [entities.id] }),
  client: one(clients, { fields: [contracts.clientId], references: [clients.id] }),
  items: many(contractItems),
  pocReports: many(pocReports),
  recognitionEntries: many(recognitionEntries),
}));

export const cashEntriesRelations = relations(cashEntries, ({ one, many }) => ({
  entity: one(entities, { fields: [cashEntries.entityId], references: [entities.id] }),
  account: one(accounts, { fields: [cashEntries.accountId], references: [accounts.id] }),
  category: one(categories, { fields: [cashEntries.categoryId], references: [categories.id] }),
  client: one(clients, { fields: [cashEntries.clientId], references: [clients.id] }),
  recognitions: many(recognitionEntries),
}));

export const recognitionEntriesRelations = relations(recognitionEntries, ({ one }) => ({
  entity: one(entities, { fields: [recognitionEntries.entityId], references: [entities.id] }),
  contract: one(contracts, {
    fields: [recognitionEntries.contractId],
    references: [contracts.id],
  }),
  category: one(categories, {
    fields: [recognitionEntries.categoryId],
    references: [categories.id],
  }),
  cashEntry: one(cashEntries, {
    fields: [recognitionEntries.cashEntryId],
    references: [cashEntries.id],
  }),
}));

/** Used by the RLS policy migration so the predicate is written in exactly one place. */
export const ENTITY_ACCESS_PREDICATE = sql`
  entity_id in (select entity_id from public.user_entities where user_id = auth.uid())
`;
