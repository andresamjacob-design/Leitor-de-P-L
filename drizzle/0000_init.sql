CREATE TYPE "public"."account_type" AS ENUM('bank', 'credit_card', 'cash', 'investment');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('revenue', 'cost', 'expense', 'tax', 'transfer', 'owner_draw');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('retainer', 'project');--> statement-breakpoint
CREATE TYPE "public"."entry_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."import_format" AS ENUM('ofx', 'csv', 'xlsx', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('parsing', 'reviewing', 'approved', 'discarded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'partially_paid', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."match_type" AS ENUM('contains', 'regex', 'exact', 'amount_range');--> statement-breakpoint
CREATE TYPE "public"."person_bond" AS ENUM('clt', 'pj', 'freelancer', 'estagio', 'socio');--> statement-breakpoint
CREATE TYPE "public"."person_kind" AS ENUM('employee', 'contractor', 'partner');--> statement-breakpoint
CREATE TYPE "public"."recognition_kind" AS ENUM('revenue', 'cost');--> statement-breakpoint
CREATE TYPE "public"."recognition_method" AS ENUM('straight_line', 'poc', 'manual');--> statement-breakpoint
CREATE TYPE "public"."recognition_source" AS ENUM('engine', 'manual', 'cash_mirror', 'accrual');--> statement-breakpoint
CREATE TYPE "public"."staged_status" AS ENUM('pending', 'approved', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."suggestion_source" AS ENUM('rule', 'ai', 'none');--> statement-breakpoint
CREATE TYPE "public"."transfer_kind" AS ENUM('card_payment', 'investment', 'internal');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"institution" text,
	"branch" text,
	"number" text,
	"last_digits" text,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"opening_date" date NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"direction" "entry_direction" NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid,
	"client_id" uuid,
	"person_id" uuid,
	"contract_id" uuid,
	"invoice_id" uuid,
	"vendor" text,
	"counterparty_name" text,
	"counterparty_tax_id" text,
	"installment_current" integer,
	"installment_total" integer,
	"external_id" text,
	"dedup_hash" text NOT NULL,
	"import_id" uuid,
	"is_intercompany" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "cash_entries_entity_dedup_key" UNIQUE("entity_id","dedup_hash")
);
--> statement-breakpoint
ALTER TABLE "cash_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"parent_id" uuid,
	"dre_group" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_entity_code_key" UNIQUE("entity_id","code")
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"match_type" "match_type" NOT NULL,
	"pattern" text NOT NULL,
	"counterparty_tax_id" text,
	"amount_min" numeric(14, 2),
	"amount_max" numeric(14, 2),
	"account_id" uuid,
	"category_id" uuid NOT NULL,
	"client_id" uuid,
	"person_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categorization_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contract_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"description" text NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "contract_type" NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"total_value" numeric(14, 2),
	"monthly_value" numeric(14, 2),
	"currency" text DEFAULT 'BRL' NOT NULL,
	"amount_original" numeric(14, 2),
	"fx_rate" numeric(18, 8),
	"fx_rate_date" date,
	"start_date" date,
	"end_date" date,
	"billing_terms" text,
	"payment_terms" text,
	"recognition_method" "recognition_method" NOT NULL,
	"prorate_first_last_month" boolean DEFAULT true NOT NULL,
	"parent_contract_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded_at" timestamp with time zone,
	"is_intercompany" boolean DEFAULT false NOT NULL,
	"source_file_id" text,
	"extracted_json" jsonb,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"tax_id" text,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"contract_id" uuid,
	"number" text NOT NULL,
	"series" text,
	"issue_date" date NOT NULL,
	"service_period" date NOT NULL,
	"due_date" date,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL,
	"withheld_iss" numeric(14, 2),
	"withheld_irrf" numeric(14, 2),
	"withheld_pis" numeric(14, 2),
	"withheld_cofins" numeric(14, 2),
	"withheld_csll" numeric(14, 2),
	"withheld_inss" numeric(14, 2),
	"net_amount" numeric(14, 2),
	"currency" text DEFAULT 'BRL' NOT NULL,
	"amount_original" numeric(14, 2),
	"fx_rate" numeric(18, 8),
	"fx_rate_date" date,
	"is_intercompany" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_entity_number_key" UNIQUE("entity_id","number","series")
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"kind" "person_kind" NOT NULL,
	"bond" "person_bond",
	"squad" text,
	"manager_name" text,
	"client_id" uuid,
	"tax_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "poc_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"period" date NOT NULL,
	"percent_complete_cumulative" numeric(6, 3) NOT NULL,
	"is_correction" boolean DEFAULT false NOT NULL,
	"reported_by" uuid,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "poc_reports_contract_period_key" UNIQUE("contract_id","period")
);
--> statement-breakpoint
ALTER TABLE "poc_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recognition_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"period" date NOT NULL,
	"contract_id" uuid,
	"client_id" uuid,
	"person_id" uuid,
	"invoice_id" uuid,
	"category_id" uuid NOT NULL,
	"kind" "recognition_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" "recognition_method",
	"source" "recognition_source" NOT NULL,
	"cash_entry_id" uuid,
	"poc_report_id" uuid,
	"manually_edited" boolean DEFAULT false NOT NULL,
	"is_intercompany" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "recognition_entries_engine_key" UNIQUE("contract_id","period","source","kind")
);
--> statement-breakpoint
ALTER TABLE "recognition_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staged_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"raw_json" jsonb,
	"external_id" text,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"counterparty_name" text,
	"counterparty_tax_id" text,
	"installment_current" integer,
	"installment_total" integer,
	"suggested_category_id" uuid,
	"suggested_client_id" uuid,
	"suggested_person_id" uuid,
	"suggestion_source" "suggestion_source" DEFAULT 'none' NOT NULL,
	"confidence" numeric(4, 3),
	"dedup_hash" text NOT NULL,
	"status" "staged_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staged_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"file_hash" text NOT NULL,
	"format" "import_format" NOT NULL,
	"period_start" date,
	"period_end" date,
	"statement_closing_balance" numeric(14, 2),
	"status" "import_status" DEFAULT 'parsing' NOT NULL,
	"error" text,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statement_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transfer_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_cash_entry_id" uuid NOT NULL,
	"to_cash_entry_id" uuid,
	"to_account_id" uuid,
	"kind" "transfer_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_pairs_from_key" UNIQUE("from_cash_entry_id")
);
--> statement-breakpoint
ALTER TABLE "transfer_pairs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_entities" (
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_entities_user_id_entity_id_pk" PRIMARY KEY("user_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "user_entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_import_id_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."statement_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poc_reports" ADD CONSTRAINT "poc_reports_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poc_reports" ADD CONSTRAINT "poc_reports_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_cash_entry_id_cash_entries_id_fk" FOREIGN KEY ("cash_entry_id") REFERENCES "public"."cash_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_entries" ADD CONSTRAINT "recognition_entries_poc_report_id_poc_reports_id_fk" FOREIGN KEY ("poc_report_id") REFERENCES "public"."poc_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_import_id_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."statement_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_suggested_category_id_categories_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_suggested_client_id_clients_id_fk" FOREIGN KEY ("suggested_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_transactions" ADD CONSTRAINT "staged_transactions_suggested_person_id_people_id_fk" FOREIGN KEY ("suggested_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pairs" ADD CONSTRAINT "transfer_pairs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pairs" ADD CONSTRAINT "transfer_pairs_from_cash_entry_id_cash_entries_id_fk" FOREIGN KEY ("from_cash_entry_id") REFERENCES "public"."cash_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pairs" ADD CONSTRAINT "transfer_pairs_to_cash_entry_id_cash_entries_id_fk" FOREIGN KEY ("to_cash_entry_id") REFERENCES "public"."cash_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pairs" ADD CONSTRAINT "transfer_pairs_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entities" ADD CONSTRAINT "user_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_entity_idx" ON "accounts" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_row_idx" ON "audit_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "cash_entries_entity_date_idx" ON "cash_entries" USING btree ("entity_id","occurred_on");--> statement-breakpoint
CREATE INDEX "cash_entries_account_idx" ON "cash_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "categories_entity_idx" ON "categories" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "categorization_rules_entity_priority_idx" ON "categorization_rules" USING btree ("entity_id","priority");--> statement-breakpoint
CREATE INDEX "clients_entity_idx" ON "clients" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "clients_tax_id_idx" ON "clients" USING btree ("entity_id","tax_id");--> statement-breakpoint
CREATE INDEX "contract_items_contract_idx" ON "contract_items" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_entity_idx" ON "contracts" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "contracts_client_idx" ON "contracts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_entity_idx" ON "invoices" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "invoices_period_idx" ON "invoices" USING btree ("entity_id","service_period");--> statement-breakpoint
CREATE INDEX "people_entity_idx" ON "people" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "poc_reports_entity_idx" ON "poc_reports" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "recognition_entries_entity_period_idx" ON "recognition_entries" USING btree ("entity_id","period");--> statement-breakpoint
CREATE INDEX "recognition_entries_contract_idx" ON "recognition_entries" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "staged_transactions_import_idx" ON "staged_transactions" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "staged_transactions_entity_idx" ON "staged_transactions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "statement_imports_entity_idx" ON "statement_imports" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "transfer_pairs_entity_idx" ON "transfer_pairs" USING btree ("entity_id");