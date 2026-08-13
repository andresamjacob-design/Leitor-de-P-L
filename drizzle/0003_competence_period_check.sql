-- The competência override is a month, not a day (DECISIONS D2b, D18). Same rule the
-- recognition ledger already enforces on `period`.
ALTER TABLE "cash_entries"
  ADD CONSTRAINT "cash_entries_competence_period_is_month_start"
  CHECK ("competence_period" IS NULL OR date_trunc('month', "competence_period") = "competence_period");--> statement-breakpoint

-- A transfer never pairs an entry with itself, and a pair belongs to one entity.
ALTER TABLE "transfer_pairs"
  ADD CONSTRAINT "transfer_pairs_two_sides"
  CHECK ("to_cash_entry_id" IS NULL OR "to_cash_entry_id" <> "from_cash_entry_id");
